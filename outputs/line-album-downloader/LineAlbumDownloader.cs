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
        public Point Menu;
    }
    public sealed class ScanResult {
        public List<Album> Albums;
        public bool ReachedBottom;
        public string Reason;
    }
    public sealed class WindowItem {
        public IntPtr Handle;
        public string Title;
        public override string ToString() { return Title + "  [" + Handle.ToInt64().ToString("X") + "]"; }
    }
    public static class TextTools {
        public static string Clean(string s) { return Regex.Replace((s ?? "").Normalize(NormalizationForm.FormKC), @"\s+", "").Trim(); }
        public static string AlbumName(string text) {
            // Windows OCR inserts a space between each Chinese word; preserve real spaces in Latin names.
            string result=(text ?? "").Trim();
            result=Regex.Replace(result,@"(?<=[\p{IsCJKUnifiedIdeographs}\p{IsCJKSymbolsandPunctuation}])\s+(?=[\p{IsCJKUnifiedIdeographs}\p{IsCJKSymbolsandPunctuation}])","");
            result=Regex.Replace(result,@"(?<=\d)\s*(/|:)\s*(?=\d)","$1");
            return result;
        }
        public static bool TryCount(string text, out int count) {
            var m = Regex.Match(Clean(text), @"^(\d{1,6})(?:張(?:照片|相片)?|個(?:項目)?|items?|photos?)?$", RegexOptions.IgnoreCase);
            count = 0;
            return m.Success && int.TryParse(m.Groups[1].Value, out count) && count > 0;
        }
        public static string SafeFolder(string name) {
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
        public static bool Same(Album a, Album b) { return a.Key == b.Key && Distance(a.Fingerprint, b.Fingerprint) <= 12; }
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
        public Recognizer() {
            engine=OcrEngine.TryCreateFromLanguage(new Language("zh-Hant-TW")) ?? OcrEngine.TryCreateFromUserProfileLanguages();
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
        Rectangle original;
        public Runner(IntPtr handle,CancellationToken cancellation,Action<string> logger,int delay) { window=handle;token=cancellation;log=logger;settle=delay;ocr=new Recognizer();original=Native.Bounds(handle); }
        async Task Wait(int milliseconds) { await Task.Delay(milliseconds,token); token.ThrowIfCancellationRequested(); }
        void Check() { token.ThrowIfCancellationRequested(); Native.Guard(window); if(Native.Bounds(window)!=original) throw new Exception("LINE 視窗位置或大小改變，已停止。請重新掃描。"); }
        async Task<Bitmap> Capture() { Check(); await Wait(120); return Native.Capture(window); }
        public async Task Validate() {
            using(var image=await Capture()) {
                var lines=await ocr.Read(image);
                bool album=lines.Any(l=>l.Box.Top<image.Height*.25 && TextTools.Clean(l.Text).Contains("相簿"));
                bool notes=lines.Any(l=>l.Box.Top<image.Height*.25 && TextTools.Clean(l.Text).Contains("記事本"));
                if(!album || !notes) throw new Exception("選到的不是相簿總覽。請選擇同時顯示『相簿／記事本』頁籤的 LINE 視窗。");
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
                result.Add(new VisibleAlbum{Data=new Album{Name=TextTools.AlbumName(title.Text),Count=count,Fingerprint=fp,State="待下載",Files=new List<string>()},Menu=new Point((int)(image.Width*.94),(int)((title.Box.Top+line.Box.Bottom)/2))});
            }
            return result;
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
            var albums=new List<Album>();string last="";int stable=0;
            for(int page=0;page<2500;page++) {
                double position;
                using(var image=await Capture()) {
                    var lines=await ocr.Read(image); Check();
                    var rows=Rows(image,lines);
                    foreach(var row in rows) if(!albums.Any(a=>TextTools.Same(a,row.Data))) { row.Data.No=albums.Count+1;albums.Add(row.Data);log("掃描 #"+row.Data.No+"："+row.Data.Name+"（"+row.Data.Count+" 張）"); }
                    var content=new Rectangle(12,(int)(image.Height*.18),image.Width-24,(int)(image.Height*.71));
                    string hash=TextTools.Fingerprint(image,content); stable=hash==last?stable+1:0;last=hash;
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
                Check();Native.Scroll(window,-240);await Wait(settle);
            }
            TextTools.AssignFolders(albums);return new ScanResult{Albums=albums,ReachedBottom=false,Reason="已達掃描頁數上限，清單可能未完整。"};
        }
        async Task<VisibleAlbum> Find(Album target) {
            string last="";int stable=0;
            for(int page=0;page<2500;page++) {
                using(var image=await Capture()) {
                    var lines=await ocr.Read(image);Check();var rows=Rows(image,lines);
                    var match=rows.FirstOrDefault(r=>TextTools.Same(r.Data,target));
                    if(match!=null)return match;
                    string hash=TextTools.Fingerprint(image,new Rectangle(12,image.Height/5,image.Width-24,image.Height*2/3));
                    stable=hash==last?stable+1:0;last=hash;if(stable>=5)throw new Exception("找不到相簿『"+target.Name+"』。清單可能改變，請重新掃描。");
                }
                Native.Scroll(window,-240);await Wait(settle);
            } throw new Exception("找相簿時已達頁數上限。");
        }
        AutomationElement FolderDialog() {
            try {
                var root=AutomationElement.FromHandle(window);
                var edit=root.FindFirst(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit),new PropertyCondition(AutomationElement.AutomationIdProperty,"1152")));
                if(edit!=null)return edit;
                var peers=AutomationElement.RootElement.FindAll(TreeScope.Children,new PropertyCondition(AutomationElement.ProcessIdProperty,(int)Native.Pid(window)));
                foreach(AutomationElement peer in peers) { edit=peer.FindFirst(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit),new PropertyCondition(AutomationElement.AutomationIdProperty,"1152")));if(edit!=null)return edit; }
            }catch{}return null;
        }
        async Task SaveAll(VisibleAlbum row,string folder) {
            Check();Native.Click(window,row.Menu);await Wait(650);
            using(var image=await Capture()) {
                var lines=await ocr.Read(image);Check();
                var save=lines.FirstOrDefault(l=> new[]{"儲存全部","全部儲存","Saveall","SaveAll"}.Contains(TextTools.Clean(l.Text)));
                if(save==null) { Native.Escape(window);throw new Exception("未辨識到『儲存全部』選單。已停止，沒有點選其他功能。"); }
                Native.Click(window,new Point((int)(save.Box.Left+save.Box.Width/2),(int)(save.Box.Top+save.Box.Height/2)));
            }
            AutomationElement edit=null;
            for(int i=0;i<50;i++) { await Wait(200);edit=FolderDialog();if(edit!=null)break; }
            if(edit==null)throw new Exception("未找到 LINE 的『選擇資料夾』視窗，已停止。");
            token.ThrowIfCancellationRequested();
            if(!Native.IsLine(Native.GetForegroundWindow()))throw new Exception("資料夾選擇視窗失去焦點，已停止。");
            object value;
            if(!edit.TryGetCurrentPattern(ValuePattern.Pattern,out value))throw new Exception("資料夾輸入框不支援自動填入，已停止。");
            ((ValuePattern)value).SetValue(folder);
            if(!String.Equals(((ValuePattern)value).Current.Value,folder,StringComparison.OrdinalIgnoreCase))throw new Exception("資料夾路徑驗證失敗，已停止。");
            AutomationElement root=edit;
            for(int up=0;up<10;up++) {
                var button=root.FindFirst(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button),new PropertyCondition(AutomationElement.AutomationIdProperty,"1")));
                if(button!=null) {
                    string text=button.Current.Name;
                    if(!(text.Contains("選擇資料夾") || text.Contains("選取資料夾") || text.Contains("Select Folder") || text.Contains("Select folder")))throw new Exception("對話框確認按鈕名稱不符，已停止。");
                    token.ThrowIfCancellationRequested();
                    object invoke;if(!button.TryGetCurrentPattern(InvokePattern.Pattern,out invoke))throw new Exception("選取資料夾按鈕無法操作。");
                    ((InvokePattern)invoke).Invoke();return;
                }
                root=TreeWalker.ControlViewWalker.GetParent(root);if(root==null)break;
            }
            throw new Exception("找不到選取資料夾按鈕。");
        }
        static bool Photo(string path) { return new[]{".jpg",".jpeg",".png",".webp",".heic",".gif",".bmp",".mp4",".mov"}.Contains(Path.GetExtension(path).ToLowerInvariant()); }
        public static bool Verified(Album album) {
            return album.State=="完成" && !String.IsNullOrEmpty(album.ActualPath) && album.Files!=null && album.Files.Count>=album.Count && album.Files.All(f=>File.Exists(f) && new FileInfo(f).Length>0);
        }
        async Task<List<string>> WaitFiles(string folder,int expected,int timeoutSeconds) {
            var watch=Stopwatch.StartNew();string previous="";int stable=0;
            while(watch.Elapsed.TotalSeconds<timeoutSeconds) {
                token.ThrowIfCancellationRequested();
                var all=Directory.GetFiles(folder,"*",SearchOption.AllDirectories);
                var photos=all.Where(Photo).Select(p=>new FileInfo(p)).ToList();
                string state=String.Join("|",photos.OrderBy(f=>f.FullName).Select(f=>f.FullName+":"+f.Length));
                bool partial=all.Any(f=>Regex.IsMatch(f,@"\.(tmp|part|download|crdownload)$",RegexOptions.IgnoreCase));
                stable=state==previous?stable+1:0;previous=state;
                if(photos.Count>=expected && photos.All(f=>f.Length>0) && !partial && stable>=8) {
                    bool readable=true;
                    foreach(var photo in photos)try{using(var f=new FileStream(photo.FullName,FileMode.Open,FileAccess.Read,FileShare.None)){}}catch(IOException){readable=false;break;}
                    if(readable)return photos.Select(f=>f.FullName).ToList();
                }
                if(watch.Elapsed.TotalSeconds%10<1)log("下載進度："+photos.Count+" / "+expected+" 張");
                await Wait(1000);
            }
            throw new Exception("下載逾時或檔案數不足。暫存照片已保留，沒有標記完成。可增加等待秒數後重試。");
        }
        public async Task Download(List<Album> albums,string root,int timeoutSeconds,Action persist) {
            await Validate();await ToTop();
            foreach(var album in albums) {
                token.ThrowIfCancellationRequested();
                if(Verified(album)) { log("略過已驗證完成："+album.Name);continue; }
                var visible=await Find(album);
                string staging=Path.Combine(root,".line-partial-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(staging);
                album.State="下載中";album.ActualPath=staging;persist();
                log("開始 #"+album.No+"："+album.Name);
                await SaveAll(visible,staging);
                var files=await WaitFiles(staging,album.Count,timeoutSeconds);
                token.ThrowIfCancellationRequested();
                string destination=Path.Combine(root,album.Folder),unique=destination;int index=2;
                while(Directory.Exists(unique)||File.Exists(unique))unique=destination+" ("+index+++")";
                Directory.Move(staging,unique);
                album.ActualPath=unique;album.Files=files.Select(f=>Path.Combine(unique,f.Substring(staging.Length).TrimStart(Path.DirectorySeparatorChar))).ToList();album.State="完成";persist();
                log("完成："+Path.GetFileName(unique)+"（"+album.Files.Count+" 張）");await Wait(500);
            }
        }
    }
    public sealed class MainForm : Form {
        public static bool PreviewMode;
        protected override bool ShowWithoutActivation { get { return PreviewMode || base.ShowWithoutActivation; } }
        ComboBox windows=new ComboBox();TextBox destination=new TextBox();DataGridView grid=new DataGridView();TextBox messages=new TextBox();
        Button browse=new Button(), refresh=new Button(), scan=new Button(), start=new Button(), stop=new Button(), open=new Button();
        NumericUpDown delay=new NumericUpDown(),timeout=new NumericUpDown();Label summary=new Label();
        List<Album> albums=new List<Album>();bool busy=false;CancellationTokenSource cancellation;WindowItem selected;
        readonly JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=20000000};
        string runFolder;
        public MainForm() {
            Text="LINE 相簿批次下載工具";Width=1000;Height=820;MinimumSize=new Size(860,700);StartPosition=FormStartPosition.CenterScreen;Font=new Font("Microsoft JhengHei UI",10);
            var panel=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=8,Padding=new Padding(16)};
            panel.RowStyles.Add(new RowStyle(SizeType.Absolute,62));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,46));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,46));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,46));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,38));panel.RowStyles.Add(new RowStyle(SizeType.Percent,60));panel.RowStyles.Add(new RowStyle(SizeType.Percent,40));panel.RowStyles.Add(new RowStyle(SizeType.Absolute,28));Controls.Add(panel);
            panel.Controls.Add(new Label{Text="1. 在 LINE 開啟目標群組的「相簿總覽」並捲到頂端。\r\n2. 選視窗、儲存位置，按「掃描相簿」；核對名稱後再開始下載。",Dock=DockStyle.Fill,ForeColor=Color.FromArgb(17,48,71)},0,0);
            var wrow=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=3};wrow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,110));wrow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));wrow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,105));wrow.Controls.Add(new Label{Text="LINE 視窗",Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleLeft},0,0);windows.Dock=DockStyle.Fill;windows.DropDownStyle=ComboBoxStyle.DropDownList;wrow.Controls.Add(windows,1,0);refresh.Text="重新整理";refresh.Dock=DockStyle.Fill;wrow.Controls.Add(refresh,2,0);panel.Controls.Add(wrow,0,1);
            var drow=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=3};drow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,110));drow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));drow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,105));drow.Controls.Add(new Label{Text="儲存位置",Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleLeft},0,0);destination.Dock=DockStyle.Fill;drow.Controls.Add(destination,1,0);browse.Text="瀏覽資料夾";browse.Dock=DockStyle.Fill;drow.Controls.Add(browse,2,0);panel.Controls.Add(drow,0,2);
            var options=new FlowLayoutPanel{Dock=DockStyle.Fill};delay.Minimum=400;delay.Maximum=5000;delay.Value=900;delay.Increment=100;delay.Width=85;timeout.Minimum=60;timeout.Maximum=7200;timeout.Value=600;timeout.Increment=60;timeout.Width=90;options.Controls.Add(new Label{Text="換頁等待（毫秒）",AutoSize=true,Padding=new Padding(0,5,0,0)});options.Controls.Add(delay);options.Controls.Add(new Label{Text="　每本下載上限（秒）",AutoSize=true,Padding=new Padding(0,5,0,0)});options.Controls.Add(timeout);panel.Controls.Add(options,0,3);
            var actions=new FlowLayoutPanel{Dock=DockStyle.Fill};scan.Text="① 掃描相簿";start.Text="② 開始下載";stop.Text="停止（F8）";open.Text="開啟儲存位置";foreach(var b in new[]{scan,start,stop,open}) { b.AutoSize=true;actions.Controls.Add(b); }stop.Enabled=false;start.Enabled=false;panel.Controls.Add(actions,0,4);
            grid.Dock=DockStyle.Fill;grid.AutoGenerateColumns=false;grid.AllowUserToAddRows=false;grid.AllowUserToDeleteRows=false;grid.RowHeadersVisible=false;grid.SelectionMode=DataGridViewSelectionMode.FullRowSelect;grid.Columns.Add(new DataGridViewTextBoxColumn{DataPropertyName="No",HeaderText="#",Width=45,ReadOnly=true});grid.Columns.Add(new DataGridViewTextBoxColumn{DataPropertyName="Name",HeaderText="LINE 辨識名稱（供比對）",AutoSizeMode=DataGridViewAutoSizeColumnMode.Fill,ReadOnly=true});grid.Columns.Add(new DataGridViewTextBoxColumn{DataPropertyName="Folder",HeaderText="下載資料夾名稱（可修正 OCR）",AutoSizeMode=DataGridViewAutoSizeColumnMode.Fill});grid.Columns.Add(new DataGridViewTextBoxColumn{DataPropertyName="Count",HeaderText="照片數",Width=75,ReadOnly=true});grid.Columns.Add(new DataGridViewTextBoxColumn{DataPropertyName="State",HeaderText="狀態",Width=90,ReadOnly=true});panel.Controls.Add(grid,0,5);
            messages.Multiline=true;messages.ScrollBars=ScrollBars.Vertical;messages.ReadOnly=true;messages.Dock=DockStyle.Fill;messages.BackColor=Color.FromArgb(245,248,250);panel.Controls.Add(messages,0,6);summary.Dock=DockStyle.Fill;summary.Text="操作期間請不要移動 LINE 視窗或使用滑鼠；F8 可停止後續操作。";panel.Controls.Add(summary,0,7);
            refresh.Click+=(s,e)=>RefreshWindows();browse.Click+=(s,e)=>{using(var dlg=new FolderBrowserDialog{Description="選擇所有 LINE 相簿的儲存位置",ShowNewFolderButton=true})if(dlg.ShowDialog(this)==DialogResult.OK)destination.Text=dlg.SelectedPath;};open.Click+=(s,e)=>{if(Directory.Exists(destination.Text))Process.Start(new ProcessStartInfo("explorer.exe","\""+destination.Text+"\""){UseShellExecute=true});};
            scan.Click+=async(s,e)=>await Run(false);start.Click+=async(s,e)=>await Run(true);stop.Click+=(s,e)=>Cancel();
            Shown+=(s,e)=>{if(PreviewMode)return;RefreshWindows();if(!Native.RegisterHotKey(Handle,1,0x4000,0x77))Log("F8 已被其他程式使用；請以停止按鈕中止。");};
            FormClosing+=(s,e)=>{if(busy){e.Cancel=true;Cancel();}else Native.UnregisterHotKey(Handle,1);};
        }
        protected override void WndProc(ref Message m) { if(m.Msg==0x312 && m.WParam.ToInt32()==1)Cancel();base.WndProc(ref m); }
        void Cancel(){if(cancellation!=null)cancellation.Cancel();Log("已要求停止；LINE 已開始的檔案傳輸可能仍會繼續。");}
        void Log(string text){if(IsDisposed)return;if(InvokeRequired){BeginInvoke(new Action<string>(Log),text);return;}messages.AppendText(DateTime.Now.ToString("HH:mm:ss")+"  "+text+Environment.NewLine);if(runFolder!=null)try{File.AppendAllText(Path.Combine(runFolder,"下載紀錄.log"),DateTime.Now.ToString("s")+" "+text+Environment.NewLine,Encoding.UTF8);}catch{}}
        void RefreshWindows(){windows.Items.Clear();foreach(var item in Native.Windows())windows.Items.Add(item);if(windows.Items.Count>0)windows.SelectedIndex=0;Log("找到 "+windows.Items.Count+" 個 LINE 視窗。請選相簿總覽，勿選聊天視窗。");}
        void SetBusy(bool state){busy=state;foreach(var c in new Control[]{refresh,browse,scan,windows,destination,delay,timeout})c.Enabled=!state;grid.ReadOnly=state;stop.Enabled=state;start.Enabled=!state&&albums.Count>0;}
        void Persist(){if(runFolder==null)return;Directory.CreateDirectory(runFolder);string file=Path.Combine(runFolder,"相簿清單.json"),temp=file+".new";File.WriteAllText(temp,json.Serialize(albums),Encoding.UTF8);if(File.Exists(file)){File.Replace(temp,file,null);}else File.Move(temp,file);var csv=new StringBuilder("順序,LINE原始辨識名稱,預定資料夾,照片數,狀態,實際路徑\r\n");foreach(var a in albums)csv.AppendLine(a.No+","+TextTools.Csv(a.Name)+","+TextTools.Csv(a.Folder)+","+a.Count+","+TextTools.Csv(a.State)+","+TextTools.Csv(a.ActualPath));File.WriteAllText(Path.Combine(runFolder,"相簿名稱對照.csv"),csv.ToString(),new UTF8Encoding(true));}
        async Task Run(bool download){
            if(busy)return;
            if(windows.SelectedItem==null){MessageBox.Show(this,"請先開啟 LINE 相簿總覽，再按重新整理。");return;}
            selected=(WindowItem)windows.SelectedItem;
            if(download){
                grid.EndEdit();string root=destination.Text.Trim();
                if(root.Length==0 || !Path.IsPathRooted(root)){MessageBox.Show(this,"請用瀏覽資料夾選擇儲存位置。");return;}
                try{root=Path.GetFullPath(root);if(root.Length>130)throw new Exception("儲存路徑過長，請改用較短路徑（130 字以內）。");Directory.CreateDirectory(root);}catch(Exception ex){MessageBox.Show(this,ex.Message);return;}
                TextTools.AssignFolders(albums);destination.Text=root;
                if(MessageBox.Show(this,"即將下載掃描清單中的 "+albums.Count+" 本相簿到：\n"+root+"\n\n請先確認清單名稱與數量。操作中不要移動 LINE 視窗。\n同名資料夾會加序號，不覆蓋既有照片。", "開始批次下載",MessageBoxButtons.OKCancel)!=DialogResult.OK)return;
                if(runFolder==null)runFolder=Path.Combine(root,"LINE下載紀錄_"+DateTime.Now.ToString("yyyyMMdd_HHmmss"));Persist();
            }
            cancellation=new CancellationTokenSource();SetBusy(true);int ms=(int)delay.Value,seconds=(int)timeout.Value;IntPtr handle=selected.Handle;string downloadRoot=destination.Text;
            try{
                Log("3 秒後開始，請保持 LINE 相簿總覽可見。");WindowState=FormWindowState.Minimized;await Task.Delay(1000,cancellation.Token);
                Native.SetForegroundWindow(handle);await Task.Delay(700,cancellation.Token);
                if(download)await Task.Run(async()=>{var runner=new Runner(handle,cancellation.Token,Log,ms);await runner.Download(albums,downloadRoot,seconds,Persist);});
                else {var result=await Task.Run(async()=>{var runner=new Runner(handle,cancellation.Token,Log,ms);return await runner.Scan();});albums=result.Albums;runFolder=null;grid.DataSource=null;grid.DataSource=albums;Log("掃描找到 "+albums.Count+" 本。"+result.Reason);if(!result.ReachedBottom)MessageBox.Show(this,result.Reason+"\n請核對相簿數量；程式不會把這次掃描標示為已確認完整。","請核對清單");}
                if(download)Log("本次清單已完成："+albums.Count(a=>Runner.Verified(a))+" / "+albums.Count+" 本。");
            }catch(OperationCanceledException){Log("已停止；完成與暫存檔均保留。");}
            catch(Exception ex){Log("停止："+ex.Message);MessageBox.Show(this,ex.Message,"已停止，請確認 LINE 畫面");}
            finally{if(download){try{Persist();}catch(Exception ex){Log("紀錄儲存失敗："+ex.Message);}}SetBusy(false);WindowState=FormWindowState.Normal;Activate();grid.Refresh();summary.Text="清單 "+albums.Count+" 本；已驗證完成 "+albums.Count(a=>Runner.Verified(a))+" 本。可修正資料夾名稱後重試。";}
        }
    }
    static class Program {
        [STAThread] static void Main(string[] args){
            if(args.Length>0 && args[0]=="--self-test"){SelfTests();return;}
            if(args.Length>1 && args[0]=="--ocr-test"){try{using(var bitmap=new Bitmap(args[1])){var lines=new Recognizer().Read(bitmap).GetAwaiter().GetResult();File.WriteAllText(args[1]+".ocr.txt",String.Join(Environment.NewLine,lines.Select(l=>l.Text)),Encoding.UTF8);}}catch(Exception ex){File.WriteAllText(args[1]+".ocr-error.txt",ex.ToString());Environment.ExitCode=1;}return;}
            if(args.Length>0 && args[0]=="--render-preview") { Native.SetProcessDPIAware();Application.EnableVisualStyles();MainForm.PreviewMode=true;using(var form=new MainForm()){form.ShowInTaskbar=false;form.StartPosition=FormStartPosition.Manual;form.Location=new Point(-30000,-30000);form.Show();Application.DoEvents();form.PerformLayout();using(var image=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(image,new Rectangle(Point.Empty,form.Size));image.Save(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"介面預覽.png"),ImageFormat.Png);}form.Close();}return; }
            Native.SetProcessDPIAware();Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new MainForm());
        }
        static void SelfTests(){
            var errors=new List<string>();Action<bool,string> assert=(ok,msg)=>{if(!ok)errors.Add(msg);};
            assert(TextTools.SafeFolder("2026/10/31:水車?")=="2026_10_31_水車_","非法字元替換");assert(TextTools.SafeFolder("CON")=="_CON","保留名稱");assert(TextTools.SafeFolder(" .. ")=="未命名相簿","空白名稱");assert(TextTools.AlbumName("水 車 跟 水 表")=="水車跟水表","中文 OCR 空白");assert(TextTools.AlbumName("Team A")=="Team A","保留英文空白");
            var albums=new List<Album>{new Album{Name="a/b"},new Album{Name="a:b"},new Album{Name="A_B"}};TextTools.AssignFolders(albums);assert(albums.Select(a=>a.Folder).Distinct(StringComparer.OrdinalIgnoreCase).Count()==3,"名稱碰撞");
            int count;assert(TextTools.TryCount("9",out count)&&count==9,"照片數字");assert(TextTools.TryCount("10 張照片",out count)&&count==10,"照片數字中文");assert(!TextTools.TryCount("2026/10/31",out count),"日期不可誤判數量");assert(!TextTools.TryCount("0",out count),"零張相簿不當作可下載");
            assert(TextTools.Distance("0000000000000000","FFFFFFFFFFFFFFFF")==64,"圖像比對距離");
            using(var image=new Bitmap(400,700)){var lines=new List<WordLine>{new WordLine{Text="2026/10/31水車",Box=new RectangleF(15,450,200,20)},new WordLine{Text="9",Box=new RectangleF(15,478,12,15)}};var rows=Runner.Rows(image,lines);assert(rows.Count==1&&rows[0].Data.Count==9,"相簿標題及照片數配對");}
            var fake=new Album{State="完成",Count=1,ActualPath="X:\\missing",Files=new List<string>{"X:\\missing\\x.jpg"}};assert(!Runner.Verified(fake),"缺失檔案不可略過");
            string path=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"self-test-result.txt");File.WriteAllText(path,errors.Count==0?"PASS: 13 checks":String.Join(Environment.NewLine,errors),Encoding.UTF8);if(errors.Count>0)Environment.ExitCode=1;
        }
    }
}
