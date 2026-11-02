using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

namespace LocalLineAlbums {
    public sealed class Album {
        public int No { get; set; }
        public string Name { get; set; }
        public string Folder { get; set; }
        public int Count { get; set; }
        public string Fingerprint { get; set; }
        public string State { get; set; }
        public string ActualPath { get; set; }
        public List<string> Files { get; set; }
        public string Key { get { return TextTools.Clean(Name) + "|" + Count; } }
    }
    public sealed class WordLine {
        public string Text;
        public RectangleF Box;
    }
    public sealed class VisibleAlbum {
        public Album Data;
        public Point OpenPoint;
        public Rectangle TitleBounds;
    }
    public sealed class ScanResult {
        public List<Album> Albums;
        public bool ReachedBottom;
        public string Reason;
    }
    public sealed class DownloadMonitorException : Exception {
        public DownloadMonitorException(string message) : base(message) { }
    }
    public sealed class WindowItem {
        public IntPtr Handle;
        public string Title;
        public string DisplayTitle;
        public override string ToString() { return String.IsNullOrEmpty(DisplayTitle)?Title + "  [" + Handle.ToInt64().ToString("X") + "]":DisplayTitle; }
    }
    public static class TextTools {
        public static string Clean(string s) { return Regex.Replace((s ?? "").Normalize(NormalizationForm.FormKC), @"\s+", "").Trim(); }
        public static string AlbumName(string text) {
            // Windows OCR inserts a space between each Chinese word; preserve real spaces in Latin names.
            string result=(text ?? "").Trim();
            result=Regex.Replace(result,@"(?<=[\p{IsCJKUnifiedIdeographs}\p{IsCJKSymbolsandPunctuation}])\s+(?=[\p{IsCJKUnifiedIdeographs}\p{IsCJKSymbolsandPunctuation}])","");
            result=Regex.Replace(result,@"(?<=\d)\s*(/|:)\s*(?=\d)","$1");
            result=Regex.Replace(result,@"(?<=\d)\s+(?=[\p{IsCJKUnifiedIdeographs}])","");
            return result;
        }
        public static bool TryCount(string text, out int count) {
            var m = Regex.Match(Clean(text), @"^(\d{1,6})(?:張(?:照片|相片)?|個(?:項目)?|items?|photos?)?$", RegexOptions.IgnoreCase);
            count = 0;
            return m.Success && int.TryParse(m.Groups[1].Value, out count) && count > 0;
        }
        public static string SafeFolder(string name) {
            name = (name ?? "").Replace("/", "");
            string result = Regex.Replace(name ?? "", @"[<>:""/\\|?*\x00-\x1f]", "_").Trim().TrimEnd('.', ' ');
            if (result.Length == 0) result = "未命名相簿";
            if (Regex.IsMatch(result, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", RegexOptions.IgnoreCase)) result = "_" + result;
            if (result.Length > 100) { result = result.Substring(0, 100); if (char.IsHighSurrogate(result[result.Length - 1])) result = result.Substring(0, result.Length - 1); }
            return result;
        }
        public static void AssignFolders(IList<Album> albums) {
            var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < albums.Count; i++) {
                var a = albums[i]; a.No = i + 1;
                string stem = SafeFolder(a.Folder ?? a.Name), candidate = stem; int suffix = 2;
                while (!used.Add(candidate)) candidate = stem + " (" + suffix++ + ")";
                a.Folder = candidate;
            }
        }
        public static string Csv(string text) { return "\"" + (text ?? "").Replace("\"", "\"\"") + "\""; }
        public static bool Same(Album a, Album b) {
            if(a.Count!=b.Count)return false;
            string left=Clean(a.Name),right=Clean(b.Name);
            int distance=Distance(a.Fingerprint,b.Fingerprint);
            if(left==right)return distance<=12;
            // Tolerate a single OCR character only when both the count and cover strongly agree.
            return left.Length>=3 && right.Length>=3 && distance<=4 && NameDistance(left,right)<=2;
        }
        public static int NameDistance(string a,string b) {
            var previous=Enumerable.Range(0,b.Length+1).ToArray();
            for(int i=1;i<=a.Length;i++) { var next=new int[b.Length+1];next[0]=i;
                for(int j=1;j<=b.Length;j++)next[j]=Math.Min(Math.Min(next[j-1]+1,previous[j]+1),previous[j-1]+(a[i-1]==b[j-1]?0:1));
                previous=next;
            }return previous[b.Length];
        }
        public static int Distance(string left, string right) {
            ulong a, b;
            if (!ulong.TryParse(left, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out a) || !ulong.TryParse(right, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out b)) return 64;
            ulong n = a ^ b; int count = 0; while(n != 0) { count++; n &= n - 1; } return count;
        }
        public static string Fingerprint(Bitmap bitmap, Rectangle region) {
            region.Intersect(new Rectangle(Point.Empty, bitmap.Size));
            if (region.Width < 10 || region.Height < 10) return "";
            using (var small = new Bitmap(9,8)) using (var g = Graphics.FromImage(small)) {
                g.DrawImage(bitmap, new Rectangle(0,0,9,8), region, GraphicsUnit.Pixel);
                ulong value = 0; int bit = 0;
                for(int y=0;y<8;y++) for(int x=0;x<8;x++) {
                    Color p=small.GetPixel(x,y), q=small.GetPixel(x+1,y);
                    if(p.R*3+p.G*6+p.B > q.R*3+q.G*6+q.B) value |= 1UL << bit; bit++;
                }
                return value.ToString("X16");
            }
        }
    }
    public static class Native {
        [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
        public delegate bool EnumProc(IntPtr hwnd, IntPtr data);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr data);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int max);
        [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd,out RECT rect);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd,uint command);
        [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
        [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd,ref POINT point);
        [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
        [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
        [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
        [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
        [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hwnd,int id,uint modifiers,uint key);
        [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hwnd,int id);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        public static uint Pid(IntPtr hwnd) { uint pid; GetWindowThreadProcessId(hwnd,out pid); return pid; }
        public static bool IsLine(IntPtr hwnd) {
            try { return Process.GetProcessById((int)Pid(hwnd)).ProcessName.Equals("LINE",StringComparison.OrdinalIgnoreCase); } catch { return false; }
        }
        public static Rectangle Bounds(IntPtr hwnd) {
            RECT r; if(!GetClientRect(hwnd,out r)) throw new Exception("LINE 視窗已關閉。");
            var p = new POINT(); ClientToScreen(hwnd,ref p);
            return new Rectangle(p.X,p.Y,r.Right-r.Left,r.Bottom-r.Top);
        }
        public static void Guard(IntPtr hwnd) {
            if(!IsWindow(hwnd) || IsIconic(hwnd) || !IsLine(hwnd)) throw new Exception("LINE 視窗已關閉或最小化，已停止。");
            if(Pid(GetForegroundWindow()) != Pid(hwnd)) throw new Exception("焦點已離開 LINE，為避免誤按已停止。請回到相簿總覽後重試。");
            var r=Bounds(hwnd);
            if(r.Width < 250 || r.Height < 300 || !SystemInformation.VirtualScreen.Contains(r)) throw new Exception("請將完整 LINE 相簿總覽移到螢幕內，視窗不要太小。");
        }
        public static Bitmap Capture(IntPtr hwnd) {
            Guard(hwnd); var r=Bounds(hwnd); var b=new Bitmap(r.Width,r.Height);
            using(var g=Graphics.FromImage(b)) g.CopyFromScreen(r.Location,Point.Empty,r.Size,CopyPixelOperation.SourceCopy);
            return b;
        }
        public static void Click(IntPtr hwnd,Point point) {
            Guard(hwnd); var r=Bounds(hwnd); if(!new Rectangle(Point.Empty,r.Size).Contains(point)) throw new Exception("點擊位置超出相簿視窗。");
            var screen=new POINT{X=r.X+point.X,Y=r.Y+point.Y};
            if(Pid(WindowFromPoint(screen)) != Pid(hwnd)) throw new Exception("LINE 被其他視窗遮住，已停止。");
            SetCursorPos(screen.X,screen.Y); mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero);
        }
        public static void ClickScreen(IntPtr hwnd,Point point) {
            Guard(hwnd); var screen=new POINT{X=point.X,Y=point.Y};
            if(Pid(WindowFromPoint(screen))!=Pid(hwnd))throw new Exception("選單被其他程式遮住，已停止。");
            SetCursorPos(point.X,point.Y);mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);
        }
        public static double DpiScale(IntPtr hwnd) { try{return Math.Max(1.0,GetDpiForWindow(hwnd)/96.0);}catch{return 1.0;} }
        public static List<Rectangle> MenuRegions(IntPtr target) {
            var bounds=Bounds(target);double dpi=DpiScale(target);
            // LINE menus may extend outside the album client and may not use it as their direct owner.
            var menuArea=new Rectangle(bounds.Right-(int)(100*dpi),bounds.Top+(int)(55*dpi),(int)(360*dpi),(int)(360*dpi));
            menuArea.Intersect(SystemInformation.VirtualScreen);
            var regions=new List<Rectangle>{bounds};if(menuArea.Width>0&&menuArea.Height>0)regions.Add(menuArea);uint pid=Pid(target);
            EnumWindows(delegate(IntPtr h,IntPtr unused){
                if(h!=target && IsWindowVisible(h) && Pid(h)==pid){
                    RECT r;if(GetWindowRect(h,out r)){var box=new Rectangle(r.Left,r.Top,r.Right-r.Left,r.Bottom-r.Top);if(box.Width>=70&&box.Width<=900&&box.Height>=40&&box.Height<=900){box.Intersect(SystemInformation.VirtualScreen);if(box.Width>0&&box.Height>0)regions.Add(box);}}
                }return true;
            },IntPtr.Zero);return regions;
        }
        public static Bitmap CaptureRegion(IntPtr target,Rectangle region) {
            Guard(target);var image=new Bitmap(region.Width,region.Height);using(var g=Graphics.FromImage(image))g.CopyFromScreen(region.Location,Point.Empty,region.Size);return image;
        }
        public static List<Bitmap> CaptureLineWindows(IntPtr target) {
            Guard(target);uint pid=Pid(target);var captures=new List<Bitmap>();
            EnumWindows(delegate(IntPtr h,IntPtr unused) {
                if(!IsWindowVisible(h)||IsIconic(h)||Pid(h)!=pid)return true;
                RECT r;if(!GetWindowRect(h,out r))return true;
                var box=Rectangle.FromLTRB(r.Left,r.Top,r.Right,r.Bottom);box.Intersect(SystemInformation.VirtualScreen);
                if(box.Width<90||box.Height<45)return true;
                try { var image=new Bitmap(box.Width,box.Height);using(var g=Graphics.FromImage(image))g.CopyFromScreen(box.Location,Point.Empty,box.Size,CopyPixelOperation.SourceCopy);captures.Add(image); } catch {}
                return true;
            },IntPtr.Zero);
            if(captures.Count==0)captures.Add(Capture(target));
            return captures;
        }
        public static Bitmap CaptureVirtualScreen(IntPtr target) {
            Guard(target);var area=SystemInformation.VirtualScreen;
            var image=new Bitmap(area.Width,area.Height);
            using(var g=Graphics.FromImage(image))g.CopyFromScreen(area.Location,Point.Empty,area.Size,CopyPixelOperation.SourceCopy);
            return image;
        }
        public static void CloseAlbumWindow(IntPtr hwnd) {
            Guard(hwnd);keybd_event(0x12,0,0,UIntPtr.Zero);keybd_event(0x73,0,0,UIntPtr.Zero);keybd_event(0x73,0,2,UIntPtr.Zero);keybd_event(0x12,0,2,UIntPtr.Zero);
        }
        public static void Scroll(IntPtr hwnd,int direction) {
            Guard(hwnd); var r=Bounds(hwnd); var p=new POINT{X=r.X+r.Width/2,Y=r.Y+(int)(r.Height*.72)};
            if(Pid(WindowFromPoint(p)) != Pid(hwnd)) throw new Exception("相簿被其他視窗遮住，已停止。");
            SetCursorPos(p.X,p.Y); mouse_event(0x800,0,0,unchecked((uint)direction),UIntPtr.Zero);
        }
        public static void Escape(IntPtr hwnd) { Guard(hwnd); keybd_event(0x1B,0,0,UIntPtr.Zero); keybd_event(0x1B,0,2,UIntPtr.Zero); }
        public static List<WindowItem> Windows() {
            var found=new List<WindowItem>();
            EnumWindows(delegate(IntPtr h,IntPtr unused) {
                if(IsWindowVisible(h) && IsLine(h)) {
                    var r=Bounds(h); if(r.Width>240 && r.Height>280) {
                        var title=new StringBuilder(512); GetWindowText(h,title,title.Capacity);
                        found.Add(new WindowItem{Handle=h,Title=title.ToString()+" ("+r.Width+"×"+r.Height+")"});
                    }
                } return true;
            },IntPtr.Zero); return found;
        }
    }
    public sealed class Recognizer {
        readonly OcrEngine engine;
        static async Task<T> Await<T>(Windows.Foundation.IAsyncOperation<T> operation) {
            var info=(Windows.Foundation.IAsyncInfo)operation;
            while(info.Status==Windows.Foundation.AsyncStatus.Started) await Task.Delay(15);
            if(info.Status==Windows.Foundation.AsyncStatus.Error) throw info.ErrorCode;
            if(info.Status==Windows.Foundation.AsyncStatus.Canceled) throw new OperationCanceledException();
            return operation.GetResults();
        }
        public Recognizer(string language="zh-Hant-TW") {
            engine=OcrEngine.TryCreateFromLanguage(new Language(language)) ?? OcrEngine.TryCreateFromUserProfileLanguages();
            if(engine==null) throw new Exception("Windows 沒有可用的 OCR 語言。請在 Windows 語言設定安裝繁體中文的文字辨識功能。");
        }
        public async Task<List<WordLine>> Read(Bitmap image) {
            double scale=Math.Min(2.0,(double)OcrEngine.MaxImageDimension/Math.Max(image.Width,image.Height));
            using(var prepared=new Bitmap(Math.Max(1,(int)(image.Width*scale)),Math.Max(1,(int)(image.Height*scale))))
            using(var ms=new MemoryStream()) {
                using(var g=Graphics.FromImage(prepared)){g.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;g.DrawImage(image,0,0,prepared.Width,prepared.Height);}
                prepared.Save(ms,ImageFormat.Png);
                using(var stream=new InMemoryRandomAccessStream()) {
                    using(var writer=new DataWriter(stream.GetOutputStreamAt(0))) { writer.WriteBytes(ms.ToArray()); await Await<uint>(writer.StoreAsync()); await Await<bool>(writer.FlushAsync()); writer.DetachStream(); }
                    stream.Seek(0);
                    var decoder=await Await<BitmapDecoder>(BitmapDecoder.CreateAsync(stream));
                    using(var bitmap=await Await<SoftwareBitmap>(decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8,BitmapAlphaMode.Premultiplied))) {
                        var result=await Await<OcrResult>(engine.RecognizeAsync(bitmap));
                        return result.Lines.Select(line=> {
                            double l=line.Words.Min(w=>w.BoundingRect.X),t=line.Words.Min(w=>w.BoundingRect.Y),r=line.Words.Max(w=>w.BoundingRect.X+w.BoundingRect.Width),b=line.Words.Max(w=>w.BoundingRect.Y+w.BoundingRect.Height);
                            return new WordLine{Text=line.Text,Box=new RectangleF((float)(l/scale),(float)(t/scale),(float)((r-l)/scale),(float)((b-t)/scale))};
                        }).ToList();
                    }
                }
            }
        }
    }
    public sealed class Runner {
        readonly IntPtr window;
        readonly Recognizer ocr;
        readonly CancellationToken token;
        readonly Action<string> log;
        readonly int settle;
        readonly Dictionary<string,Album> rowCache=new Dictionary<string,Album>();
        IntPtr activeAlbumWindow=IntPtr.Zero;
        public List<Album> LiveAlbums { get; private set; }
        public static int LastOcrReads,LastCacheHits; public static string LastOcrText;
        Rectangle original;
        public Runner(IntPtr handle,CancellationToken cancellation,Action<string> logger,int delay) { window=handle;token=cancellation;log=logger;settle=delay;ocr=new Recognizer();original=Native.Bounds(handle);LiveAlbums=new List<Album>(); }
        async Task Wait(int milliseconds) { await Task.Delay(milliseconds,token); token.ThrowIfCancellationRequested(); }
        void Check() { token.ThrowIfCancellationRequested(); Native.Guard(window); if(Native.Bounds(window)!=original) throw new Exception("LINE 視窗位置或大小改變，已停止。請重新掃描。"); }
        async Task<Bitmap> Capture() { Check(); await Wait(120); return Native.Capture(window); }
        public async Task Validate() {
            using(var image=await Capture()) {
                var lines=await ocr.Read(image);
                bool album=lines.Any(l=>l.Box.Top<image.Height*.25 && TextTools.Clean(l.Text).Contains("相簿"));
                int anchors=AlbumDots(image).Count;
                if(!album&&anchors==0)throw new Exception("無法確認選到相簿總覽：上方未辨識到『相簿』，右側也沒有相簿三點。請確認選取的 LINE 視窗及目前畫面。");
                if(!album)log("『相簿』頁籤 OCR 未辨識，但已在總覽右側找到 "+anchors+" 個相簿三點，繼續操作。");
            }
        }
        public static List<VisibleAlbum> Rows(Bitmap image,List<WordLine> lines) {
            var result=new List<VisibleAlbum>();
            foreach(var line in lines.OrderBy(l=>l.Box.Top)) {
                int count;
                if(line.Box.Top<image.Height*.17 || line.Box.Left>image.Width*.35 || !TextTools.TryCount(line.Text,out count)) continue;
                var title=lines.Where(l=>l.Box.Left<image.Width*.35 && l.Box.Bottom<=line.Box.Top+2 && line.Box.Top-l.Box.Bottom<Math.Max(40,image.Width*.12) && !TextTools.Clean(l.Text).Equals("相簿") && !TextTools.Clean(l.Text).Equals("記事本")).OrderByDescending(l=>l.Box.Bottom).FirstOrDefault();
                if(title==null || title.Box.Top<image.Height*.14 || title.Text.Trim().Length==0) continue;
                // Album names occur directly below the cover and directly above a small photo count.
                if(title.Box.Top>image.Height-35 || line.Box.Bottom>image.Height-8) continue;
                var cover=new Rectangle((int)(image.Width*.08),(int)title.Box.Top-(int)(image.Width*.23),(int)(image.Width*.78),(int)(image.Width*.19));
                string fp=TextTools.Fingerprint(image,cover); if(fp.Length==0)continue;
                result.Add(new VisibleAlbum{Data=new Album{Name=TextTools.AlbumName(title.Text),Count=count,Fingerprint=fp,State="待下載",Files=new List<string>()},OpenPoint=new Point((int)(title.Box.Left+title.Box.Width/2),(int)(title.Box.Top+title.Box.Height/2)),TitleBounds=Rectangle.FromLTRB(0,Math.Max(0,(int)title.Box.Top-4),image.Width-10,Math.Min(image.Height,(int)Math.Ceiling(title.Box.Bottom)+4))});
            }
            return result;
        }
        async Task<List<VisibleAlbum>> ReadRows(Bitmap image) {
            var rows=await ReadRows(image,ocr,token,rowCache);Check();
            if(LastCacheHits>0)log("略過重複區域 OCR："+LastCacheHits+" 本；新辨識："+LastOcrReads+" 本。");
            return rows;
        }
        public static async Task<List<VisibleAlbum>> ReadRows(Bitmap image,Recognizer ocr,CancellationToken token) {
            return await ReadRows(image,ocr,token,new Dictionary<string,Album>());
        }
        public static List<Rectangle> AlbumDots(Bitmap image) {
            int left=(int)(image.Width*.82),top=(int)(image.Height*.2),width=image.Width-left;
            var dark=new bool[width*image.Height];var seen=new bool[dark.Length];var dots=new List<Rectangle>();
            for(int y=top;y<image.Height;y++)for(int x=left;x<image.Width;x++) {
                Color c=image.GetPixel(x,y);dark[y*width+x-left]=c.R<115&&c.G<115&&c.B<115;
            }
            for(int y=top;y<image.Height;y++)for(int x=0;x<width;x++) {
                int start=y*width+x;if(!dark[start]||seen[start])continue;
                var queue=new Queue<int>();queue.Enqueue(start);seen[start]=true;
                int minX=x,maxX=x,minY=y,maxY=y,count=0;
                while(queue.Count>0) {
                    int n=queue.Dequeue(),px=n%width,py=n/width;count++;
                    minX=Math.Min(minX,px);maxX=Math.Max(maxX,px);minY=Math.Min(minY,py);maxY=Math.Max(maxY,py);
                    foreach(int delta in new[]{-1,1,-width,width}) {
                        int next=n+delta;if(next<top*width||next>=dark.Length||Math.Abs(next%width-px)+Math.Abs(next/width-py)!=1)continue;
                        if(dark[next]&&!seen[next]){seen[next]=true;queue.Enqueue(next);}
                    }
                }
                int w=maxX-minX+1,h=maxY-minY+1;
                if(w>=2&&h>=2&&w<=12&&h<=12&&w<=h*2&&h<=w*2&&count>=3)dots.Add(new Rectangle(left+minX,minY,w,h));
            }
            var anchors=new List<Rectangle>();
            foreach(var a in dots.OrderBy(d=>d.Top)) {
                var below=dots.Where(d=>Math.Abs((d.Left+d.Width/2)-(a.Left+a.Width/2))<=2&&d.Top>a.Bottom+1&&d.Top-a.Top<=a.Height*9).OrderBy(d=>d.Top).ToList();
                if(below.Count<2)continue;var b=below[0];var c=below[1];
                if(Math.Abs((b.Top-a.Top)-(c.Top-b.Top))>Math.Max(2,a.Height)||Math.Abs(a.Width-b.Width)>2||Math.Abs(a.Width-c.Width)>2)continue;
                var box=Rectangle.FromLTRB(a.Left,a.Top,Math.Max(a.Right,Math.Max(b.Right,c.Right)),c.Bottom);
                // Menu dots are on a plain white margin, not embedded in a cover photo.
                int sx=Math.Max(0,box.Left-8);Color margin=image.GetPixel(sx,box.Top+box.Height/2);
                if(margin.R<235||margin.G<235||margin.B<235||anchors.Any(r=>r.IntersectsWith(box)))continue;
                anchors.Add(box);
            }return anchors;
        }
        public static Rectangle? FindWindowEllipsis(Bitmap image) {
            // Search the album window's upper-right control area. The screenshot shows the album's
            // ellipsis below its minimize/close controls; keeping this band narrow avoids matching
            // the separate main LINE window's ellipsis when it is visible beside the album popup.
            // Coordinates are pixels from this album-window capture, never from the album title.
            int left=(int)(image.Width*.58),right=image.Width;
            int top=(int)(image.Height*.055),bottom=Math.Min(image.Height,(int)(image.Height*.24));
            int width=right-left,height=bottom-top;var dark=new bool[width*height];var seen=new bool[dark.Length];var dots=new List<Rectangle>();
            for(int y=0;y<height;y++)for(int x=0;x<width;x++){Color c=image.GetPixel(left+x,top+y);dark[y*width+x]=c.R<110&&c.G<110&&c.B<110;}
            for(int y=0;y<height;y++)for(int x=0;x<width;x++){
                int start=y*width+x;if(!dark[start]||seen[start])continue;var q=new Queue<int>();q.Enqueue(start);seen[start]=true;
                int minX=x,maxX=x,minY=y,maxY=y,pixels=0;
                while(q.Count>0){int n=q.Dequeue(),px=n%width,py=n/width;pixels++;minX=Math.Min(minX,px);maxX=Math.Max(maxX,px);minY=Math.Min(minY,py);maxY=Math.Max(maxY,py);
                    foreach(int d in new[]{-1,1,-width,width}){int k=n+d;if(k<0||k>=dark.Length||Math.Abs(k%width-px)+Math.Abs(k/width-py)!=1)continue;if(dark[k]&&!seen[k]){seen[k]=true;q.Enqueue(k);}}
                }
                int w=maxX-minX+1,h=maxY-minY+1;if(w>=2&&h>=2&&w<=9&&h<=9&&pixels>=3)dots.Add(new Rectangle(left+minX,top+minY,w,h));
            }
            var candidates=new List<Rectangle>();
            foreach(var a in dots.OrderBy(d=>d.Top)){
                var below=dots.Where(d=>Math.Abs(d.Left+d.Width/2-a.Left-a.Width/2)<=2&&d.Top>=a.Bottom+2&&d.Top-a.Top<=30).OrderBy(d=>d.Top).ToList();
                if(below.Count<2)continue;var b=below[0];var c=below[1];
                int gap1=b.Top-a.Top,gap2=c.Top-b.Top;
                if(Math.Abs(gap1-gap2)>Math.Max(3,a.Height)||Math.Abs(a.Width-b.Width)>2||Math.Abs(a.Width-c.Width)>2)continue;
                candidates.Add(Rectangle.FromLTRB(Math.Min(a.Left,Math.Min(b.Left,c.Left)),a.Top,Math.Max(a.Right,Math.Max(b.Right,c.Right)),c.Bottom));
            }
            return candidates
                .Where(r=>r.Left+ r.Width/2>=image.Width*.72)
                .OrderBy(r=>Math.Abs((r.Left+r.Width/2)-image.Width*.93)/image.Width + Math.Abs((r.Top+r.Height/2)-image.Height*.105)/image.Height)
                .Cast<Rectangle?>().FirstOrDefault();
        }
        public static async Task<List<VisibleAlbum>> ReadRows(Bitmap image,Recognizer ocr,CancellationToken token,Dictionary<string,Album> cache) {
            var rows=new List<VisibleAlbum>();LastOcrReads=0;LastCacheHits=0;
            foreach(var dots in AlbumDots(image)) {
                token.ThrowIfCancellationRequested();
                double scale=Math.Max(1.0,dots.Height/20.0);
                var box=Rectangle.FromLTRB((int)(8*scale),Math.Max((int)(image.Height*.2),dots.Top-(int)(23*scale)),dots.Left-(int)(8*scale),Math.Min(image.Height,dots.Bottom+(int)(24*scale)));
                // Wait for the entire label and count to enter the viewport.
                if(box.Width<80||dots.Bottom+20*scale>=image.Height||dots.Top-23*scale<image.Height*.2)continue;
                string key=FrameSignature(image,box);Album data;
                if(cache.TryGetValue(key,out data))LastCacheHits++;
                else {
                using(var crop=new Bitmap(box.Width*2,box.Height*2)) {
                    using(var g=Graphics.FromImage(crop))g.DrawImage(image,new Rectangle(0,0,crop.Width,crop.Height),box,GraphicsUnit.Pixel);
                    var lines=await ocr.Read(crop);LastOcrReads++;LastOcrText=String.Join(" | ",lines.Select(l=>l.Text+" "+l.Box));
                    int count=0;var number=lines.OrderByDescending(l=>l.Box.Top).FirstOrDefault(l=>TextTools.TryCount(l.Text,out count));
                    if(number==null) {
                        // Small gray counts need their own numeric OCR region and language.
                        int countTop=dots.Top+(int)(11*scale);
                        var countBox=new Rectangle(box.Left,countTop,Math.Min(box.Width,(int)(110*scale)),Math.Min(image.Height-countTop,(int)(36*scale)));
                        using(var digits=new Bitmap(countBox.Width+140,countBox.Height+70)) {
                            using(var g=Graphics.FromImage(digits))using(var font=new Font("Arial",14,FontStyle.Regular,GraphicsUnit.Pixel)) {
                                g.Clear(Color.White);g.DrawString("Count",font,Brushes.Black,12,29);
                                g.DrawImage(image,new Rectangle(110,25,countBox.Width,countBox.Height),countBox,GraphicsUnit.Pixel);
                            }
                            var numeric=await new Recognizer("en-US").Read(digits);
                            var n=numeric.FirstOrDefault(l=>TextTools.TryCount(Regex.Replace(TextTools.Clean(l.Text),"^Count", "",RegexOptions.IgnoreCase),out count));
                            LastOcrText+=" NUMERIC: "+String.Join("|",numeric.Select(l=>l.Text));
                            if(n==null||!TextTools.TryCount(Regex.Replace(TextTools.Clean(n.Text),"^Count","",RegexOptions.IgnoreCase),out count))continue;
                        }
                    } else TextTools.TryCount(number.Text,out count);
                    var titles=lines.Where(l=>l.Box.Top<(dots.Top+11*scale-box.Top)*2 && (number==null||l.Box.Bottom<=number.Box.Top+2)).OrderBy(l=>l.Box.Top).ThenBy(l=>l.Box.Left).ToList();
                    string title=TextTools.AlbumName(String.Join(" ",titles.Select(l=>l.Text)));
                    if(title.Length==0)continue;
                    data=new Album{Name=title,Count=count};cache[key]=data;
                }
                }
                var cover=Rectangle.FromLTRB((int)(image.Width*.08),Math.Max((int)(image.Height*.2),dots.Top-(int)(32*scale)-(int)(image.Width*.19)),(int)(image.Width*.86),dots.Top-(int)(32*scale));
                // A cover cut off by the fixed header cannot supply a comparable fingerprint.
                if(dots.Top-(int)(32*scale)-(int)(image.Width*.19)<image.Height*.2)continue;
                string fingerprint=TextTools.Fingerprint(image,cover);
                if(fingerprint.Length==0)continue;
                double estimatedWidth=data.Name.Sum(ch=>ch>='\u2E80'&&ch<='\u9FFF'?16.0:8.0)*scale;
                int clickX=box.Left+Math.Min(box.Width-2,Math.Max(1,(int)(estimatedWidth/2)));
                int clickY=dots.Top-(int)(12*scale);
                rows.Add(new VisibleAlbum{Data=new Album{Name=data.Name,Count=data.Count,Fingerprint=fingerprint,State="待下載",Files=new List<string>()},OpenPoint=new Point(clickX,clickY),TitleBounds=box});
            }
            return rows;
        }
        static string FrameSignature(Bitmap image,Rectangle box) {
            using(var crop=image.Clone(box,PixelFormat.Format24bppRgb))using(var stream=new MemoryStream())using(var hash=System.Security.Cryptography.SHA256.Create()) {
                crop.Save(stream,ImageFormat.Bmp);return Convert.ToBase64String(hash.ComputeHash(stream.ToArray()));
            }
        }
        double ScrollPosition() {
            try {
                var root=AutomationElement.FromHandle(window);
                var bars=root.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.ScrollBar));
                foreach(AutomationElement bar in bars) {
                    var box=bar.Current.BoundingRectangle; if(box.Height<box.Width || box.Height<100)continue;
                    object pattern;
                    if(bar.TryGetCurrentPattern(RangeValuePattern.Pattern,out pattern)) { var v=((RangeValuePattern)pattern).Current; if(v.Maximum>v.Minimum)return (v.Value-v.Minimum)/(v.Maximum-v.Minimum); }
                }
            } catch { }
            return -1;
        }
        async Task ToTop() {
            string last="";int stable=0;
            for(int i=0;i<350;i++) {
                Check(); Native.Scroll(window,1440); await Wait(settle);
                using(var image=await Capture()) {
                    string hash=TextTools.Fingerprint(image,new Rectangle(15,image.Height/4,image.Width-30,image.Height/2));
                    double p=ScrollPosition();
                    if(p>=0 && p<.0001)return;
                    stable=hash==last ? stable+1 : 0; last=hash;
                    if(stable>=3)return;
                }
            } throw new Exception("無法回到相簿清單頂端，請手動捲到頂端再試。");
        }
        public async Task<ScanResult> Scan() {
            await Validate(); await ToTop();
            var albums=new List<Album>();var votes=new Dictionary<Album,Dictionary<string,int>>();string last="";int stable=0;
            for(int page=0;page<2500;page++) {
                double position;
                using(var image=await Capture()) {
                    var rows=await ReadRows(image);
                    foreach(var row in rows) {
                        var matches=albums.Where(a=>TextTools.Same(a,row.Data)).ToList();
                        if(matches.Count==0) {
                            row.Data.No=albums.Count+1;albums.Add(row.Data);
                            votes[row.Data]=new Dictionary<string,int>{{row.Data.Name,1}};
                            log("掃描 #"+row.Data.No+"："+row.Data.Name+"（"+row.Data.Count+" 張）");
                        } else if(matches.Count==1) {
                            var existing=matches[0];var tally=votes[existing];
                            if(!tally.ContainsKey(row.Data.Name))tally[row.Data.Name]=0;
                            tally[row.Data.Name]++;
                            existing.Name=tally.OrderByDescending(v=>v.Value).First().Key;
                        } else throw new Exception("多本相簿的名稱、張數及封面過於相似，無法可靠區分，請先確認清單。");
                    }
                    var content=new Rectangle(12,(int)(image.Height*.18),image.Width-24,(int)(image.Height*.71));
                    string hash=FrameSignature(image,content); stable=hash==last?stable+1:0;last=hash;
                    position=ScrollPosition();
                    if(position>=.9999 && stable>=1) {
                        if(albums.Count==0)throw new Exception("沒有辨識到相簿，請確認總覽已載入照片及數量。");
                        TextTools.AssignFolders(albums); return new ScanResult{Albums=albums,ReachedBottom=true,Reason="已讀到垂直捲軸底部。"};
                    }
                    if(stable>=5) {
                        if(albums.Count==0)throw new Exception("沒有辨識到相簿。畫面可能被遮住或尚未載入。");
                        TextTools.AssignFolders(albums); return new ScanResult{Albums=albums,ReachedBottom=false,Reason="畫面連續未變動，但無法讀取捲軸底部；請確認清單是否完整。"};
                    }
                }
                Check();Native.Scroll(window,-80);await Wait(Math.Min(settle,300));
            }
            TextTools.AssignFolders(albums);return new ScanResult{Albums=albums,ReachedBottom=false,Reason="已達掃描頁數上限，清單可能未完整。"};
        }
        public async Task DownloadAsYouScan(string root,int timeoutSeconds,Action persist) {
            await Validate();LiveAlbums=new List<Album>();var failures=new List<string>();string last="";int stable=0;
            log("從目前相簿總覽捲軸位置開始即時掃描。");
            for(int page=0;page<2500;page++) {
                double position;
                using(var image=await Capture()) {
                    var rows=await ReadRows(image);
                    foreach(var row in rows) {
                        var matches=LiveAlbums.Where(a=>TextTools.Same(a,row.Data)).ToList();
                        if(matches.Count>0)continue;
                        row.Data.No=LiveAlbums.Count+1;row.Data.Folder=TextTools.SafeFolder(row.Data.Name);LiveAlbums.Add(row.Data);persist();
                        log("即時找到 #"+row.Data.No+"："+row.Data.Name+"（"+row.Data.Count+" 張），立即下載。");
                        IntPtr albumWindow=IntPtr.Zero;string staging=Path.Combine(root,".line-partial-"+Guid.NewGuid().ToString("N"));string phase="開啟相簿";
                        try {
                            Directory.CreateDirectory(staging);row.Data.State="下載中";row.Data.ActualPath=staging;persist();
                            phase="確認儲存全部";albumWindow=await SaveAll(row,staging,row.Data);
                            phase="等待下載提示消失";var files=await WaitFiles(staging,row.Data.Count,timeoutSeconds,albumWindow);
                            string dest=Path.Combine(root,row.Data.Folder),unique=dest;int suffix=2;
                            while(Directory.Exists(unique)||File.Exists(unique))unique=dest+" ("+suffix+++")";
                            Directory.Move(staging,unique);row.Data.ActualPath=unique;
                            row.Data.Files=files.Select(f=>Path.Combine(unique,f.Substring(staging.Length).TrimStart(Path.DirectorySeparatorChar))).ToList();row.Data.State="完成";persist();
                            log("完成："+Path.GetFileName(unique)+"。");
                        } catch(OperationCanceledException){throw;}
                        catch(DownloadMonitorException ex){row.Data.State="下載狀態未確認："+ex.Message;persist();log("沒有確認本本下載中視窗消失兩次；停止目前流程，不會提早開下一本。");throw;}
                        catch(Exception ex){row.Data.State="失敗（"+phase+"）："+ex.Message;failures.Add("#"+row.Data.No+" "+row.Data.Name+"（"+phase+"）："+ex.Message);persist();log("本本失敗，繼續往下："+row.Data.Name+"；"+ex.Message);}
                        IntPtr closing=Native.IsWindow(albumWindow)?albumWindow:activeAlbumWindow;
                        try{if(Native.IsWindow(closing)){Native.Guard(closing);Native.CloseAlbumWindow(closing);await Wait(350);}}catch(Exception ex){log("關閉單本視窗時發生問題："+ex.Message);}
                        activeAlbumWindow=IntPtr.Zero;
                        Native.SetForegroundWindow(window);await Wait(500);Check();
                    }
                    string hash=FrameSignature(image,new Rectangle(12,(int)(image.Height*.18),image.Width-24,(int)(image.Height*.71)));
                    stable=hash==last?stable+1:0;last=hash;position=ScrollPosition();
                    if(position>=.9999&&stable>=1)break;
                    if(stable>=5)throw new Exception("清單畫面停止變化，但沒有確認已捲到底；已處理 "+LiveAlbums.Count+" 本，未宣稱全部掃描完成。");
                }
                Check();Native.Scroll(window,-80);await Wait(Math.Min(settle,300));
            }
            if(LiveAlbums.Count==0)throw new Exception("沒有找到可下載的相簿。");
            if(failures.Count>0)throw new Exception("即時下載完成，以下項目失敗：\r\n"+String.Join("\r\n",failures));
        }
        public async Task<ScanResult> ScanCurrentPage() {
            await Validate();using(var image=await Capture()) {
                var rows=await ReadRows(image);var items=rows.Select(r=>r.Data).ToList();
                if(items.Count==0)throw new Exception("目前頁沒有完整顯示的相簿名稱與照片張數，請稍微捲動總覽再試。");
                TextTools.AssignFolders(items);return new ScanResult{Albums=items,ReachedBottom=false,Reason="僅掃描目前顯示的相簿，可選取一列進行單本測試。"};
            }
        }
        async Task<VisibleAlbum> Find(Album target) {
            string last="";int stable=0;
            for(int page=0;page<2500;page++) {
                using(var image=await Capture()) {
                    var rows=await ReadRows(image);
                    var matches=rows.Where(r=>TextTools.Same(r.Data,target)).ToList();
                    if(matches.Count==0)matches=rows.Where(r=>r.Data.Count==target.Count&&TextTools.Distance(r.Data.Fingerprint,target.Fingerprint)<=4).ToList();
                    if(matches.Count>1)throw new Exception("同一畫面有多本相似相簿，無法唯一定位，已停止。");
                    var match=matches.FirstOrDefault();
                    if(match!=null)return match;
                    string hash=FrameSignature(image,new Rectangle(12,image.Height/5,image.Width-24,image.Height*2/3));
                    stable=hash==last?stable+1:0;last=hash;if(stable>=5)throw new Exception("找不到相簿『"+target.Name+"』。清單可能改變，請重新掃描。");
                }
                Native.Scroll(window,-80);await Wait(Math.Min(settle,300));
            } throw new Exception("找相簿時已達頁數上限。");
        }
        AutomationElement FolderDialog(IntPtr owner) {
            try {
                var root=AutomationElement.FromHandle(owner);
                var edit=root.FindFirst(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit),new PropertyCondition(AutomationElement.AutomationIdProperty,"1152")));
                if(edit!=null)return edit;
                var peers=AutomationElement.RootElement.FindAll(TreeScope.Children,new PropertyCondition(AutomationElement.ProcessIdProperty,(int)Native.Pid(owner)));
                foreach(AutomationElement peer in peers) { edit=peer.FindFirst(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit),new PropertyCondition(AutomationElement.AutomationIdProperty,"1152")));if(edit!=null)return edit; }
            }catch{}return null;
        }
        static bool IsSaveAllOption(string text) {
            string value=TextTools.Clean(text).ToLowerInvariant();
            return (value.Contains("全部")&&(value.Contains("儲存")||value.Contains("保存")))||value.Contains("saveall");
        }
        async Task<IntPtr> SaveAll(VisibleAlbum row,string folder,Album target) {
            Check();var prior=new HashSet<IntPtr>(Native.Windows().Select(w=>w.Handle));
            // Click the album title in the overview to open its separate window.
            Native.Click(window,row.OpenPoint);IntPtr albumWindow=IntPtr.Zero;
            for(int i=0;i<35;i++) {
                await Wait(200);var candidates=Native.Windows().Where(w=>w.Handle!=window&&Native.Pid(w.Handle)==Native.Pid(window)).ToList();
                var added=candidates.Where(w=>!prior.Contains(w.Handle)).ToList();
                if(added.Count==1){albumWindow=added[0].Handle;break;}
                var active=candidates.Where(w=>w.Handle==Native.GetForegroundWindow()).ToList();
                if(active.Count==1){albumWindow=active[0].Handle;break;}
            }
            if(albumWindow==IntPtr.Zero)throw new Exception("點相簿名稱後，未找到單本相簿視窗，已停止。");
            activeAlbumWindow=albumWindow;
            Native.Guard(albumWindow);await Wait(settle);
            using(var image=Native.Capture(albumWindow)) {
                var lines=await ocr.Read(image);Native.Guard(albumWindow);
                var header=lines.Where(l=>l.Box.Top<image.Height*.35&&l.Box.Left<image.Width*.85).ToList();
                // The album window is opened by clicking this exact overview row, so its OCR title
                // is not used to decide whether it is the right album or to rename its folder.
                float headerBottom=header.Count==0?image.Height*.05f:header.Max(l=>l.Box.Bottom);
                int count=0;var countLine=lines.FirstOrDefault(l=>l.Box.Top>=headerBottom&&l.Box.Top<image.Height*.6&&TextTools.TryCount(l.Text,out count));
                bool hasCount=countLine!=null&&TextTools.TryCount(countLine.Text,out count);
                bool sameCount=hasCount&&count==target.Count;
                if(hasCount&&!sameCount)throw new Exception("單本相簿辨識到的張數（"+count+"）與總覽（"+target.Count+"）不同，已停止，沒有按儲存。");
                if(!hasCount)log("相簿頁張數 OCR 未讀到，依總覽已選取的「"+row.Data.Name+"」繼續。");
                else log("已開啟總覽選取的「"+row.Data.Name+"」相簿（"+count+" 張）。");
            }
            int dotAttempts=0;
            for(int attempt=0;attempt<3;attempt++) {
                Rectangle? ellipsis=null;
                for(int poll=0;poll<40&&!ellipsis.HasValue;poll++) {
                    token.ThrowIfCancellationRequested();
                    using(var image=Native.Capture(albumWindow))ellipsis=FindWindowEllipsis(image);
                    if(!ellipsis.HasValue){dotAttempts++;if(dotAttempts%8==0)log("仍在尋找相簿視窗右上三點，已重試 "+dotAttempts+" 次。");await Wait(250);}
                }
                if(!ellipsis.HasValue)continue;
                var menuClick=new Point(ellipsis.Value.Left+ellipsis.Value.Width/2,ellipsis.Value.Top+ellipsis.Value.Height/2);
                log("影像辨識到三點（第 "+(attempt+1)+" 次點擊），像素座標："+menuClick.X+","+menuClick.Y);
                Native.Click(albumWindow,menuClick);await Wait(2000);
                Point? savePoint=null;bool menuSeen=false;
                for(int readAttempt=0;readAttempt<10&&savePoint==null;readAttempt++) {
                    foreach(var region in Native.MenuRegions(albumWindow).AsEnumerable().Reverse()) {
                        using(var image=Native.CaptureRegion(albumWindow,region)) {
                            var lines=await ocr.Read(image);Native.Guard(albumWindow);
                            menuSeen|=lines.Any(l=>{string text=TextTools.Clean(l.Text);return new[]{"選擇項目","修改相簿名稱","刪除相簿","分享相簿"}.Any(text.Contains)||new[]{"selectitems","editalbumname","deletealbum","sharealbum"}.Any(text.ToLowerInvariant().Contains);});
                            var save=lines.FirstOrDefault(l=>IsSaveAllOption(l.Text));
                            if(save!=null){savePoint=new Point(region.X+(int)(save.Box.Left+save.Box.Width/2),region.Y+(int)(save.Box.Top+save.Box.Height/2));break;}
                        }
                    }
                    if(savePoint==null&&menuSeen)await Wait(500);
                    else if(savePoint==null)break;
                }
                if(savePoint==null){Native.Escape(albumWindow);log(menuSeen?"選單已打開但還沒辨識到「全部儲存」，重新點三點再找一次。":"三點點擊後還沒辨識到選單，重新找三點並重試。");await Wait(350);continue;}
                log("已辨識到三點選單的「全部儲存」，點選第 "+(attempt+1)+" 次。");
                bool clicked=false;try { Native.ClickScreen(albumWindow,savePoint.Value);clicked=true; }
                catch(Exception ex){log("點選「全部儲存」失敗，重試："+ex.Message);}
                if(!clicked){Native.Escape(albumWindow);await Wait(350);continue;}
                log("已點選「全部儲存」，等待 LINE 的資料夾選擇視窗。");
                AutomationElement edit=null;
                for(int i=0;i<50;i++) { await Wait(200);edit=FolderDialog(albumWindow);if(edit!=null)break; }
                if(edit==null){log("點選後尚未出現資料夾視窗，再試一次「全部儲存」。");Native.Escape(albumWindow);await Wait(350);continue;}
                token.ThrowIfCancellationRequested();
                if(!Native.IsLine(Native.GetForegroundWindow()))throw new Exception("資料夾選擇視窗失去焦點。");
                object value;
                if(!edit.TryGetCurrentPattern(ValuePattern.Pattern,out value))throw new Exception("資料夾輸入框不支援自動填入。");
                ((ValuePattern)value).SetValue(folder);
                if(!String.Equals(((ValuePattern)value).Current.Value,folder,StringComparison.OrdinalIgnoreCase))throw new Exception("資料夾路徑驗證失敗。");
                AutomationElement root=edit;
                for(int up=0;up<10;up++) {
                    var button=root.FindFirst(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button),new PropertyCondition(AutomationElement.AutomationIdProperty,"1")));
                    if(button!=null) {
                        string text=button.Current.Name;
                        if(!(text.Contains("選擇資料夾") || text.Contains("選取資料夾") || text.Contains("Select Folder") || text.Contains("Select folder")))throw new Exception("對話框確認按鈕名稱不符。");
                        token.ThrowIfCancellationRequested();
                        object invoke;if(!button.TryGetCurrentPattern(InvokePattern.Pattern,out invoke))throw new Exception("選取資料夾按鈕無法操作。");
                        ((InvokePattern)invoke).Invoke();log("已確認下載資料夾，下載已啟動。");return albumWindow;
                    }
                    root=TreeWalker.ControlViewWalker.GetParent(root);if(root==null)break;
                }
                throw new Exception("找不到選取資料夾按鈕。");
            }
            throw new Exception("重試三次後仍未能確認已按下「全部儲存」並開啟資料夾視窗。");
        }
        static bool Photo(string path) { return new[]{".jpg",".jpeg",".png",".webp",".heic",".gif",".bmp",".mp4",".mov"}.Contains(Path.GetExtension(path).ToLowerInvariant()); }
        public static bool Verified(Album album) {
            return album.State=="完成" && !String.IsNullOrEmpty(album.ActualPath) && Directory.Exists(album.ActualPath);
        }
        async Task<List<string>> WaitFiles(string folder,int expected,int timeoutSeconds,IntPtr albumWindow) {
            var watch=Stopwatch.StartNew();bool sawDownloading=false;int absentScans=0,checks=0;
            log("每秒先 OCR 單本相簿視窗，再檢查整個螢幕尋找「正在下載」；看到後連續兩次未看到才會下一本。");
            while(watch.Elapsed.TotalSeconds<timeoutSeconds) {
                token.ThrowIfCancellationRequested();long checkStart=watch.ElapsedMilliseconds;bool downloading=false;
                try {
                    if(Native.IsWindow(albumWindow)) {
                        using(var albumScreen=Native.Capture(albumWindow)) {
                            var status=await ocr.Read(albumScreen);downloading=HasDownloadingText(status);
                        }
                    }
                    if(!downloading) {
                        using(var screen=Native.CaptureVirtualScreen(window)) {
                            var status=await ocr.Read(screen);downloading=HasDownloadingText(status);
                        }
                    }
                    if(!downloading) {
                        var screens=Native.CaptureLineWindows(window);
                        try {
                            foreach(var screen in screens) {
                                if(downloading)break;
                                using(screen) {
                                    var status=await ocr.Read(screen);
                                    downloading=HasDownloadingText(status);
                                }
                            }
                        } finally { foreach(var screen in screens)screen.Dispose(); }
                    }
                } catch(OperationCanceledException){throw;}
                catch(Exception ex){throw new Exception("無法讀取 LINE 下載視窗："+ex.Message);}
                checks++;
                if(downloading) {
                    absentScans=0;
                    if(!sawDownloading){sawDownloading=true;log("已在相簿／螢幕畫面辨識到「正在下載」（本本預計 "+expected+" 張）。");}
                } else if(sawDownloading) {
                    absentScans++;
                    log("第 "+absentScans+" 次每秒確認：未看到 LINE 下載中視窗。"+(absentScans<2?"再確認一次。":""));
                } else if(checks==1||checks%5==0) {
                    log("尚未辨識到 LINE 下載中視窗，繼續每秒檢查，不會開下一本。");
                }
                if(sawDownloading&&absentScans>=2) {
                    log("LINE 下載中視窗連續兩次未出現，確認本本下載結束，繼續下一本。");
                    return Directory.GetFiles(folder,"*",SearchOption.AllDirectories).Where(Photo).ToList();
                }
                await Wait((int)Math.Max(0,1000-(watch.ElapsedMilliseconds-checkStart)));
            }
            throw new DownloadMonitorException(sawDownloading
                ?"已逾時，但 LINE 下載中視窗未連續兩次消失。"
                :"已逾時，始終未辨識到「正在下載」視窗。");
        }
        static bool HasDownloadingText(List<WordLine> lines) {
            string text=TextTools.Clean(String.Concat(lines.OrderBy(l=>l.Box.Top).ThenBy(l=>l.Box.Left).Select(l=>l.Text))).ToLowerInvariant();
            return text.Contains("正在下載")||text.Contains("下載中")||text.Contains("downloading");
        }
        public async Task Download(List<Album> albums,string root,int timeoutSeconds,Action persist) {
            await Validate();await ToTop();
            var failures=new List<string>();
            foreach(var album in albums) {
                token.ThrowIfCancellationRequested();
                if(Verified(album)) { log("略過已驗證完成："+album.Name);continue; }
                IntPtr albumWindow=IntPtr.Zero;string phase="尋找相簿";string staging=Path.Combine(root,".line-partial-"+Guid.NewGuid().ToString("N"));
                try {
                    var visible=await Find(album);Directory.CreateDirectory(staging);
                    album.State="下載中";album.ActualPath=staging;persist();
                    log("開始 #"+album.No+"："+album.Name);
                    phase="確認相簿及選擇儲存全部";
                    albumWindow=await SaveAll(visible,staging,album);persist();
                    phase="等待下載提示消失";
                    var files=await WaitFiles(staging,album.Count,timeoutSeconds,albumWindow);
                    token.ThrowIfCancellationRequested();
                    string destination=Path.Combine(root,album.Folder),unique=destination;int index=2;
                    while(Directory.Exists(unique)||File.Exists(unique))unique=destination+" ("+index+++")";
                    Directory.Move(staging,unique);
                    album.ActualPath=unique;album.Files=files.Select(f=>Path.Combine(unique,f.Substring(staging.Length).TrimStart(Path.DirectorySeparatorChar))).ToList();album.State="完成";persist();
                    log("完成："+Path.GetFileName(unique)+"（"+album.Files.Count+" 張）");
                } catch(OperationCanceledException) { throw; }
                catch(DownloadMonitorException ex) { album.State="下載狀態未確認："+ex.Message;persist();log("沒有確認本本下載中視窗消失兩次；停止目前流程，不會提早開下一本。");throw; }
                catch(Exception ex) {
                    album.State="失敗（"+phase+"）："+ex.Message;failures.Add("#"+album.No+" "+album.Name+"（"+phase+"）："+ex.Message);persist();
                    log("本本失敗，繼續下一本："+album.Name+"；階段："+phase+"；"+ex.Message);
                }
                IntPtr toClose=Native.IsWindow(albumWindow)?albumWindow:activeAlbumWindow;
                try { if(Native.IsWindow(toClose)){Native.Guard(toClose);Native.CloseAlbumWindow(toClose);await Wait(400);} } catch(Exception ex){log("關閉相簿視窗時發生問題："+ex.Message);}
                activeAlbumWindow=IntPtr.Zero;
                if(Native.IsWindow(window)){
                    for(int attempt=0;attempt<3&&Native.Pid(Native.GetForegroundWindow())!=Native.Pid(window);attempt++){Native.SetForegroundWindow(window);await Wait(350);}
                    if(Native.Pid(Native.GetForegroundWindow())!=Native.Pid(window))throw new Exception("無法將焦點移回 LINE 相簿總覽，為避免操作錯誤已停止後續下載。");
                    Check();
                }
            }
            if(failures.Count>0)throw new Exception("以下相簿下載失敗（已繼續處理其餘項目）：\r\n"+String.Join("\r\n",failures));
        }
    }
    public sealed class MainForm : Form {
        public static bool PreviewMode;
        protected override bool ShowWithoutActivation { get { return PreviewMode || base.ShowWithoutActivation; } }
        ComboBox windows=new ComboBox();TextBox destination=new TextBox();DataGridView grid=new DataGridView();TextBox messages=new TextBox();
        Button browse=new Button(), refresh=new Button(), scan=new Button(), current=new Button(), start=new Button(), live=new Button(), stop=new Button(), open=new Button();
        CheckBox selectedOnly=new CheckBox{Text="僅下載選取的相簿",AutoSize=true};
        NumericUpDown delay=new NumericUpDown(),timeout=new NumericUpDown();Label summary=new Label();
        List<Album> albums=new List<Album>();bool busy=false;CancellationTokenSource cancellation;WindowItem selected;
        readonly JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=20000000};
        string runFolder;
        public MainForm() {
            Text="LINE 相簿下載";Width=780;Height=650;MinimumSize=new Size(700,570);StartPosition=FormStartPosition.CenterScreen;Font=new Font("Microsoft JhengHei UI",10);BackColor=Color.FromArgb(241,245,249);
            var panel=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=5,Padding=new Padding(20)};
            panel.RowStyles.Add(new RowStyle(SizeType.Absolute,112));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,16));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,258));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,14));panel.RowStyles.Add(new RowStyle(SizeType.Percent,100));Controls.Add(panel);
            var hero=new Panel{Dock=DockStyle.Fill,BackColor=Color.FromArgb(22,48,71),Padding=new Padding(22,16,22,12)};
            var heroLayout=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=2};heroLayout.RowStyles.Add(new RowStyle(SizeType.Percent,60));heroLayout.RowStyles.Add(new RowStyle(SizeType.Percent,40));
            heroLayout.Controls.Add(new Label{Text="LINE 相簿下載",Dock=DockStyle.Fill,ForeColor=Color.White,Font=new Font("Microsoft JhengHei UI",20,FontStyle.Bold),TextAlign=ContentAlignment.BottomLeft},0,0);
            heroLayout.Controls.Add(new Label{Text="選擇相簿總覽視窗與儲存位置，即可開始逐本下載。",Dock=DockStyle.Fill,ForeColor=Color.FromArgb(205,220,232),Font=new Font("Microsoft JhengHei UI",10),TextAlign=ContentAlignment.MiddleLeft},0,1);
            hero.Controls.Add(heroLayout);panel.Controls.Add(hero,0,0);

            var settings=new Panel{Dock=DockStyle.Fill,BackColor=Color.White,Padding=new Padding(18)};settings.Paint+=(s,e)=>ControlPaint.DrawBorder(e.Graphics,settings.ClientRectangle,Color.FromArgb(220,228,236),ButtonBorderStyle.Solid);
            var form=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=6};form.RowStyles.Add(new RowStyle(SizeType.Absolute,28));form.RowStyles.Add(new RowStyle(SizeType.Absolute,24));form.RowStyles.Add(new RowStyle(SizeType.Absolute,40));form.RowStyles.Add(new RowStyle(SizeType.Absolute,24));form.RowStyles.Add(new RowStyle(SizeType.Absolute,40));form.RowStyles.Add(new RowStyle(SizeType.Percent,100));
            form.Controls.Add(new Label{Text="下載設定",Dock=DockStyle.Fill,ForeColor=Color.FromArgb(28,48,66),Font=new Font("Microsoft JhengHei UI",12,FontStyle.Bold),TextAlign=ContentAlignment.MiddleLeft},0,0);
            form.Controls.Add(new Label{Text="LINE 視窗",Dock=DockStyle.Fill,ForeColor=Color.FromArgb(75,91,106),TextAlign=ContentAlignment.BottomLeft},0,1);
            var wrow=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,Margin=new Padding(0,3,0,3)};wrow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));wrow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,104));windows.Dock=DockStyle.Fill;windows.DropDownStyle=ComboBoxStyle.DropDownList;windows.Font=new Font("Microsoft JhengHei UI",10);windows.Margin=new Padding(0,0,8,0);wrow.Controls.Add(windows,0,0);refresh.Text="重新整理";refresh.Dock=DockStyle.Fill;StyleButton(refresh,Color.FromArgb(231,239,246),Color.FromArgb(31,68,96),false);wrow.Controls.Add(refresh,1,0);form.Controls.Add(wrow,0,2);
            form.Controls.Add(new Label{Text="儲存位置",Dock=DockStyle.Fill,ForeColor=Color.FromArgb(75,91,106),TextAlign=ContentAlignment.BottomLeft},0,3);
            var drow=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,Margin=new Padding(0,3,0,3)};drow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));drow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,104));destination.Dock=DockStyle.Fill;destination.ReadOnly=true;destination.BackColor=Color.FromArgb(248,250,252);destination.Margin=new Padding(0,0,8,0);drow.Controls.Add(destination,0,0);browse.Text="選擇資料夾";browse.Dock=DockStyle.Fill;StyleButton(browse,Color.FromArgb(231,239,246),Color.FromArgb(31,68,96),false);drow.Controls.Add(browse,1,0);form.Controls.Add(drow,0,4);
            live.Text="即時掃描並下載";live.Dock=DockStyle.Fill;live.Margin=new Padding(0,12,0,0);StyleButton(live,Color.FromArgb(16,126,111),Color.White,true);form.Controls.Add(live,0,5);settings.Controls.Add(form);panel.Controls.Add(settings,0,2);

            var activity=new Panel{Dock=DockStyle.Fill,BackColor=Color.White,Padding=new Padding(16)};activity.Paint+=(s,e)=>ControlPaint.DrawBorder(e.Graphics,activity.ClientRectangle,Color.FromArgb(220,228,236),ButtonBorderStyle.Solid);
            var logLayout=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=3};logLayout.RowStyles.Add(new RowStyle(SizeType.Absolute,30));logLayout.RowStyles.Add(new RowStyle(SizeType.Absolute,28));logLayout.RowStyles.Add(new RowStyle(SizeType.Percent,100));
            logLayout.Controls.Add(new Label{Text="執行狀態",Dock=DockStyle.Fill,ForeColor=Color.FromArgb(28,48,66),Font=new Font("Microsoft JhengHei UI",11,FontStyle.Bold),TextAlign=ContentAlignment.MiddleLeft},0,0);
            summary.Dock=DockStyle.Fill;summary.Text="準備就緒。請在 LINE 開啟相簿總覽。";summary.ForeColor=Color.FromArgb(75,91,106);logLayout.Controls.Add(summary,0,1);
            messages.Multiline=true;messages.ScrollBars=ScrollBars.Vertical;messages.ReadOnly=true;messages.Dock=DockStyle.Fill;messages.BorderStyle=BorderStyle.None;messages.BackColor=Color.FromArgb(248,250,252);messages.Font=new Font("Microsoft JhengHei UI",9);logLayout.Controls.Add(messages,0,2);activity.Controls.Add(logLayout);panel.Controls.Add(activity,0,4);
            refresh.Click+=async(s,e)=>await RefreshWindows();browse.Click+=(s,e)=>{using(var dlg=new FolderBrowserDialog{Description="選擇所有 LINE 相簿的儲存位置",ShowNewFolderButton=true})if(dlg.ShowDialog(this)==DialogResult.OK)destination.Text=dlg.SelectedPath;};
            live.Click+=async(s,e)=>await Run(true,false,true);
            Shown+=async(s,e)=>{if(PreviewMode)return;await RefreshWindows();if(!Native.RegisterHotKey(Handle,1,0x4000,0x77))Log("F8 已被其他程式使用；目前無法使用快捷鍵停止。");};
            FormClosing+=(s,e)=>{if(busy){e.Cancel=true;Cancel();}else Native.UnregisterHotKey(Handle,1);};
        }
        static void StyleButton(Button button,Color back,Color fore,bool primary){button.FlatStyle=FlatStyle.Flat;button.FlatAppearance.BorderSize=primary?0:1;button.FlatAppearance.BorderColor=Color.FromArgb(205,216,226);button.BackColor=back;button.ForeColor=fore;button.Font=new Font("Microsoft JhengHei UI",primary?11:9.5f,primary?FontStyle.Bold:FontStyle.Regular);button.Cursor=Cursors.Hand;button.UseVisualStyleBackColor=false;}
        protected override void WndProc(ref Message m) { if(m.Msg==0x312 && m.WParam.ToInt32()==1)Cancel();base.WndProc(ref m); }
        void Cancel(){if(cancellation!=null)cancellation.Cancel();Log("已要求停止；LINE 已開始的檔案傳輸可能仍會繼續。");}
        void Log(string text){if(IsDisposed)return;if(InvokeRequired){BeginInvoke(new Action<string>(Log),text);return;}messages.AppendText(DateTime.Now.ToString("HH:mm:ss")+"  "+text+Environment.NewLine);if(runFolder!=null)try{File.AppendAllText(Path.Combine(runFolder,"下載紀錄.log"),DateTime.Now.ToString("s")+" "+text+Environment.NewLine,Encoding.UTF8);}catch{}}
        static int TabUnderline(Bitmap image,WordLine label) {
            int cx=(int)(label.Box.Left+label.Box.Width/2),radius=(int)(image.Width*.16);
            int left=Math.Max(0,cx-radius),right=Math.Min(image.Width,cx+radius);
            int top=Math.Max(0,(int)label.Box.Bottom+2),bottom=Math.Min(image.Height,top+28),best=0;
            for(int y=top;y<bottom;y++) {
                int run=0;
                for(int x=left;x<right;x++) {Color c=image.GetPixel(x,y);if(c.R<115&&c.G<115&&c.B<115){run++;best=Math.Max(best,run);}else run=0;}
            }
            return best;
        }
        static int TabInk(Bitmap image,WordLine label) {
            int left=Math.Max(0,(int)label.Box.Left),right=Math.Min(image.Width,(int)Math.Ceiling(label.Box.Right));
            int top=Math.Max(0,(int)label.Box.Top),bottom=Math.Min(image.Height,(int)Math.Ceiling(label.Box.Bottom));
            int dark=0,total=Math.Max(1,(right-left)*(bottom-top));
            for(int y=top;y<bottom;y++)for(int x=left;x<right;x++){Color c=image.GetPixel(x,y);if(c.R<125&&c.G<125&&c.B<125)dark++;}
            return dark*10000/total;
        }
        static string GroupTabLabel(List<WordLine> lines,Bitmap image) {
            var albumTab=lines.FirstOrDefault(l=>l.Box.Top<image.Height*.28&&TextTools.Clean(l.Text)=="相簿");
            var notesTab=lines.FirstOrDefault(l=>l.Box.Top<image.Height*.28&&TextTools.Clean(l.Text)=="記事本");
            if(albumTab==null||notesTab==null)return null;
            var title=lines.Where(l=>l.Box.Top<albumTab.Box.Top&&l.Box.Top<image.Height*.2&&Math.Abs(l.Box.Left+l.Box.Width/2-image.Width/2)<image.Width*.2)
                .OrderByDescending(l=>l.Box.Height).FirstOrDefault();
            if(title==null)return null;
            int albumUnderline=TabUnderline(image,albumTab),notesUnderline=TabUnderline(image,notesTab);
            string tab;
            if(Math.Max(albumUnderline,notesUnderline)>=image.Width*.1&&Math.Abs(albumUnderline-notesUnderline)>=image.Width*.05)
                tab=albumUnderline>notesUnderline?"相簿":"記事本";
            else tab=TabInk(image,albumTab)>=TabInk(image,notesTab)?"相簿":"記事本";
            string name=TextTools.AlbumName(title.Text);
            return String.IsNullOrWhiteSpace(name)?null:name+" & "+tab;
        }
        async Task RefreshWindows(){
            if(busy)return;IntPtr keep=windows.SelectedItem is WindowItem?(windows.SelectedItem as WindowItem).Handle:IntPtr.Zero;
            var items=Native.Windows();var previousState=WindowState;refresh.Enabled=false;WindowState=FormWindowState.Minimized;
            try {
                await Task.Delay(180);Recognizer reader=null;try{reader=new Recognizer();}catch{}
                foreach(var item in items) {
                    if(reader==null||!Native.IsWindow(item.Handle))continue;
                    try {
                        Native.SetForegroundWindow(item.Handle);await Task.Delay(180);
                        using(var image=Native.Capture(item.Handle)) {
                            var lines=await reader.Read(image);string groupTab=GroupTabLabel(lines,image);
                            if(!String.IsNullOrEmpty(groupTab))item.DisplayTitle=groupTab;
                        }
                    } catch {}
                }
            } finally {WindowState=previousState==FormWindowState.Minimized?FormWindowState.Normal:previousState;Activate();refresh.Enabled=true;}
            windows.BeginUpdate();windows.Items.Clear();foreach(var item in items)windows.Items.Add(item);
            windows.SelectedIndex=-1;for(int i=0;i<windows.Items.Count;i++)if(((WindowItem)windows.Items[i]).Handle==keep){windows.SelectedIndex=i;break;}
            windows.EndUpdate();Log("找到 "+windows.Items.Count+" 個 LINE 視窗；群組頁會顯示「群組名稱 & 相簿／記事本」，一般對話仍顯示原名稱。");
        }
        void SetBusy(bool state){busy=state;foreach(var c in new Control[]{refresh,browse,scan,current,selectedOnly,windows,destination,delay,timeout,live})c.Enabled=!state;grid.ReadOnly=state;stop.Enabled=state;start.Enabled=!state&&albums.Count>0;live.Text=state?"即時掃描下載中…":"即時掃描並下載";if(state)summary.Text="正在下載，請勿操作 LINE 視窗；按 F8 可停止後續操作。";}
        void Persist(){if(runFolder==null)return;Directory.CreateDirectory(runFolder);string file=Path.Combine(runFolder,"相簿清單.json"),temp=file+".new";File.WriteAllText(temp,json.Serialize(albums),Encoding.UTF8);if(File.Exists(file)){File.Replace(temp,file,null);}else File.Move(temp,file);var csv=new StringBuilder("順序,LINE原始辨識名稱,預定資料夾,照片數,狀態,實際路徑\r\n");foreach(var a in albums)csv.AppendLine(a.No+","+TextTools.Csv(a.Name)+","+TextTools.Csv(a.Folder)+","+a.Count+","+TextTools.Csv(a.State)+","+TextTools.Csv(a.ActualPath));File.WriteAllText(Path.Combine(runFolder,"相簿名稱對照.csv"),csv.ToString(),new UTF8Encoding(true));}
        async Task Run(bool download,bool currentPage=false,bool liveMode=false){
            if(busy)return;
            if(windows.SelectedItem==null){MessageBox.Show(this,"請先在上方選擇 LINE 相簿總覽視窗。");return;}
            selected=(WindowItem)windows.SelectedItem;
            List<Album> requested=albums;
            if(download){
                grid.EndEdit();string root=destination.Text.Trim();
                if(!liveMode&&selectedOnly.Checked){requested=grid.SelectedRows.Cast<DataGridViewRow>().Select(r=>r.DataBoundItem as Album).Where(a=>a!=null).OrderBy(a=>a.No).ToList();if(requested.Count==0){MessageBox.Show(this,"請先選取要測試下載的相簿列。");return;}}
                if(root.Length==0 || !Path.IsPathRooted(root)){MessageBox.Show(this,"請用瀏覽資料夾選擇儲存位置。");return;}
                try{root=Path.GetFullPath(root);if(root.Length>130)throw new Exception("儲存路徑過長，請改用較短路徑（130 字以內）。");Directory.CreateDirectory(root);}catch(Exception ex){MessageBox.Show(this,ex.Message);return;}
                TextTools.AssignFolders(albums);destination.Text=root;
                string prompt=liveMode?"即時掃描 LINE 相簿總覽，看到一本就下載一本，完成後繼續往下。\n\n儲存位置：\n"+root:"即將下載 "+requested.Count+" 本相簿到：\n"+root+"\n\n"+String.Join("\n",requested.Take(5).Select(a=>a.Name+"（"+a.Count+" 張）"))+"\n\n請先確認清單名稱與數量。";
                if(MessageBox.Show(this,prompt+"\n\n操作中不要移動 LINE 視窗。\n同名資料夾會加序號，不覆蓋既有照片。",liveMode?"開始即時掃描下載":"開始批次下載",MessageBoxButtons.OKCancel)!=DialogResult.OK)return;
                if(runFolder==null)runFolder=Path.Combine(root,"LINE下載紀錄_"+DateTime.Now.ToString("yyyyMMdd_HHmmss"));Persist();
            }
            cancellation=new CancellationTokenSource();SetBusy(true);int ms=(int)delay.Value,seconds=(int)timeout.Value;IntPtr handle=selected.Handle;string downloadRoot=destination.Text;
            try{
                Log("3 秒後開始，請保持 LINE 相簿總覽可見。");WindowState=FormWindowState.Minimized;await Task.Delay(1000,cancellation.Token);
                Native.SetForegroundWindow(handle);await Task.Delay(700,cancellation.Token);
                if(download&&liveMode){var runner=new Runner(handle,cancellation.Token,Log,ms);try{await Task.Run(async()=>await runner.DownloadAsYouScan(downloadRoot,seconds,Persist));}finally{albums=runner.LiveAlbums;grid.DataSource=null;grid.DataSource=albums;}}
                else if(download)await Task.Run(async()=>{var runner=new Runner(handle,cancellation.Token,Log,ms);await runner.Download(requested,downloadRoot,seconds,Persist);});
                else {var result=await Task.Run(async()=>{var runner=new Runner(handle,cancellation.Token,Log,ms);return currentPage?await runner.ScanCurrentPage():await runner.Scan();});albums=result.Albums;runFolder=null;grid.DataSource=null;grid.DataSource=albums;Log("掃描找到 "+albums.Count+" 本。"+result.Reason);if(!result.ReachedBottom&&!currentPage)MessageBox.Show(this,result.Reason+"\n請核對相簿數量；程式不會把這次掃描標示為已確認完整。","請核對清單");}
                if(download)Log("本次清單已完成："+requested.Count(a=>Runner.Verified(a))+" / "+requested.Count+" 本。");
            }catch(OperationCanceledException){Log("已停止；完成與暫存檔均保留。");}
            catch(Exception ex){Log("停止："+ex.Message);MessageBox.Show(this,ex.Message,"已停止，請確認 LINE 畫面");}
            finally{if(download){try{Persist();}catch(Exception ex){Log("紀錄儲存失敗："+ex.Message);}}SetBusy(false);WindowState=FormWindowState.Normal;Activate();grid.Refresh();summary.Text="本次處理 "+albums.Count+" 本；完成 "+albums.Count(a=>a.State=="完成")+" 本，失敗 "+albums.Count(a=>a.State!=null&&a.State.StartsWith("失敗"))+" 本。詳細紀錄已寫入儲存位置。";}
        }
    }
    static class Program {
        [STAThread] static void Main(string[] args){
            if(args.Length>0 && args[0]=="--self-test"){SelfTests();return;}
            if(args.Length>1 && args[0]=="--anchor-test"){AnchorTests(args[1]);return;}
            if(args.Length>1 && args[0]=="--ocr-test"){try{using(var bitmap=new Bitmap(args[1])){var lines=new Recognizer().Read(bitmap).GetAwaiter().GetResult();File.WriteAllText(args[1]+".ocr.txt",String.Join(Environment.NewLine,lines.Select(l=>l.Text)),Encoding.UTF8);}}catch(Exception ex){File.WriteAllText(args[1]+".ocr-error.txt",ex.ToString());Environment.ExitCode=1;}return;}
            if(args.Length>1 && args[0]=="--reference-test") {try{using(var bitmap=new Bitmap(args[1])){var lines=new Recognizer().Read(bitmap).GetAwaiter().GetResult();var rows=Runner.ReadRows(bitmap,new Recognizer(),CancellationToken.None).GetAwaiter().GetResult();var report=new StringBuilder();report.AppendLine("LABEL OCR: "+Runner.LastOcrText);foreach(var dot in Runner.AlbumDots(bitmap))report.AppendLine("DOTS: "+dot);foreach(var l in lines)report.AppendLine(l.Text);report.AppendLine("--- DETECTED ALBUMS ---");foreach(var row in rows)report.AppendLine(row.Data.Name+" | "+row.Data.Count+" | open="+row.OpenPoint);File.WriteAllText(args[1]+".analysis.txt",report.ToString(),Encoding.UTF8);if(rows.Count!=1||rows[0].Data.Count!=10)Environment.ExitCode=2;}}catch(Exception ex){File.WriteAllText(args[1]+".analysis-error.txt",ex.ToString());Environment.ExitCode=1;}return;}
            if(args.Length>0 && args[0]=="--render-preview") { Native.SetProcessDPIAware();Application.EnableVisualStyles();MainForm.PreviewMode=true;using(var form=new MainForm()){form.ShowInTaskbar=false;form.StartPosition=FormStartPosition.Manual;form.Location=new Point(-30000,-30000);form.Show();Application.DoEvents();form.PerformLayout();using(var image=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(image,new Rectangle(Point.Empty,form.Size));image.Save(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"介面預覽.png"),ImageFormat.Png);}form.Close();}return; }
            Native.SetProcessDPIAware();Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new MainForm());
        }
        static void AnchorTests(string path) {
            var report=new List<string>();int failed=0;
            Action<bool,string> check=(ok,label)=>{report.Add((ok?"PASS: ":"FAIL: ")+label);if(!ok)failed++;};
            try {
                using(var original=new Bitmap(path)) {
                    var recognizer=new Recognizer();var cache=new Dictionary<string,Album>();
                    var first=Runner.ReadRows(original,recognizer,CancellationToken.None,cache).GetAwaiter().GetResult();
                    check(first.Count==1&&first[0].Data.Name=="2026/10/31早上水車跟水表"&&first[0].Data.Count==10,"anchor title and count");
                    Runner.ReadRows(original,recognizer,CancellationToken.None,cache).GetAwaiter().GetResult();
                    check(Runner.LastOcrReads==0&&Runner.LastCacheHits==1,"identical frame skips OCR");
                    using(var moved=new Bitmap(original.Width,original.Height)) {
                        using(var g=Graphics.FromImage(moved)){g.Clear(Color.White);g.DrawImageUnscaled(original,0,-80);}
                        var rows=Runner.ReadRows(moved,recognizer,CancellationToken.None,cache).GetAwaiter().GetResult();
                        check(rows.Count==1&&Runner.LastOcrReads==0&&Runner.LastCacheHits==1,"scrolled label skips OCR");
                        check(rows.Count==1&&first.Count==1&&TextTools.Same(rows[0].Data,first[0].Data),"scrolled cover keeps album identity");
                    }
                    using(var scaled=new Bitmap(original.Width*3/2,original.Height*3/2)) {
                        using(var g=Graphics.FromImage(scaled))g.DrawImage(original,0,0,scaled.Width,scaled.Height);
                        var rows=Runner.ReadRows(scaled,recognizer,CancellationToken.None).GetAwaiter().GetResult();
                        report.Add("Scaled dots: "+String.Join(";",Runner.AlbumDots(scaled))+" OCR: "+Runner.LastOcrText+" Rows: "+String.Join(";",rows.Select(r=>r.Data.Name+" / "+r.Data.Count)));
                        check(rows.Count==1&&rows[0].Data.Name=="2026/10/31早上水車跟水表"&&rows[0].Data.Count==10,"150 percent reference scale");
                    }
                    using(var blank=new Bitmap(original.Width,original.Height)) {
                        using(var g=Graphics.FromImage(blank))g.Clear(Color.White);
                        var rows=Runner.ReadRows(blank,recognizer,CancellationToken.None).GetAwaiter().GetResult();
                        check(rows.Count==0&&Runner.LastOcrReads==0,"no dots means no label OCR");
                    }
                    using(var multiple=new Bitmap(original.Width,original.Height*2)) {
                        using(var g=Graphics.FromImage(multiple)){g.Clear(Color.White);g.DrawImageUnscaled(original,0,0);g.DrawImageUnscaled(original,0,original.Height);}
                        var rows=Runner.ReadRows(multiple,recognizer,CancellationToken.None,new Dictionary<string,Album>()).GetAwaiter().GetResult();
                        check(rows.Count==2&&rows.All(r=>r.Data.Count==10),"two anchors produce two visible rows even with identical labels");
                    }
                }
            }catch(Exception ex){report.Add(ex.ToString());failed++;}
            File.WriteAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"anchor-test-result.txt"),report,Encoding.UTF8);if(failed>0)Environment.ExitCode=1;
        }
        static void SelfTests(){
            var errors=new List<string>();Action<bool,string> assert=(ok,msg)=>{if(!ok)errors.Add(msg);};
            assert(TextTools.SafeFolder("2026/10/31:水車?")=="20261031_水車_","斜線刪除及其他非法字元替換");assert(TextTools.SafeFolder("CON")=="_CON","保留名稱");assert(TextTools.SafeFolder(" .. ")=="未命名相簿","空白名稱");assert(TextTools.AlbumName("水 車 跟 水 表")=="水車跟水表","中文 OCR 空白");assert(TextTools.AlbumName("Team A")=="Team A","保留英文空白");assert(TextTools.AlbumName("2026 / 10 / 31 早 上 水 車 跟 水 表")=="2026/10/31早上水車跟水表","相簿實際日期名稱空白");
            var albums=new List<Album>{new Album{Name="a/b"},new Album{Name="a:b"},new Album{Name="A_B"}};TextTools.AssignFolders(albums);assert(albums.Select(a=>a.Folder).Distinct(StringComparer.OrdinalIgnoreCase).Count()==3,"名稱碰撞");
            int count;assert(TextTools.TryCount("9",out count)&&count==9,"照片數字");assert(TextTools.TryCount("10 張照片",out count)&&count==10,"照片數字中文");assert(!TextTools.TryCount("2026/10/31",out count),"日期不可誤判數量");assert(!TextTools.TryCount("0",out count),"零張相簿不當作可下載");
            assert(TextTools.Distance("0000000000000000","FFFFFFFFFFFFFFFF")==64,"圖像比對距離");
            var reference=new Album{Name="2026/10/31早上水車跟水表",Count=10,Fingerprint="0000000000000000"};
            assert(TextTools.Same(reference,new Album{Name="2026/10/31早上水軍跟水表",Count=10,Fingerprint="0000000000000001"}),"同封面同張數允許單字 OCR 誤差");
            assert(!TextTools.Same(reference,new Album{Name=reference.Name,Count=11,Fingerprint=reference.Fingerprint}),"不同張數不可合併");
            assert(!TextTools.Same(reference,new Album{Name="2026/10/31早上水軍跟水表",Count=10,Fingerprint="FFFFFFFFFFFFFFFF"}),"文字接近但封面不同不可合併");
            using(var image=new Bitmap(400,700)){var lines=new List<WordLine>{new WordLine{Text="2026/10/31水車",Box=new RectangleF(15,450,200,20)},new WordLine{Text="9",Box=new RectangleF(15,478,12,15)}};var rows=Runner.Rows(image,lines);assert(rows.Count==1&&rows[0].Data.Count==9,"相簿標題及照片數配對");}
            var fake=new Album{State="完成",Count=1,ActualPath="X:\\missing",Files=new List<string>{"X:\\missing\\x.jpg"}};assert(!Runner.Verified(fake),"缺失檔案不可略過");
            string path=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"self-test-result.txt");File.WriteAllText(path,errors.Count==0?"PASS: 17 checks":String.Join(Environment.NewLine,errors),Encoding.UTF8);if(errors.Count>0)Environment.ExitCode=1;
        }
    }
}
