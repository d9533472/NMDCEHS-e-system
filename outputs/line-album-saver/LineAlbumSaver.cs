// LINE 相簿批次儲存工具
// 以 UI Automation 讀取 LINE 視窗類型與元件位置（GroupHomeWindow＝相簿總覽、AlbumDetailWindow＝單本相簿、
// LcContextMenu＝⋮ 選單），文字（相簿名稱、張數）用 Windows 內建 OCR 辨識，全部在本機執行。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;
using System.Windows.Forms;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

namespace LineAlbumSaver {
    static class N {
        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
        [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
        [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint data, UIntPtr extra);
        [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte scan, uint f, UIntPtr extra);
        [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint mod, uint key);
        [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

        public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
        public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, s.Capacity); return s.ToString(); }
        public static double Scale(IntPtr h) { try { uint d = GetDpiForWindow(h); return d > 0 ? d / 96.0 : 1.0; } catch { return 1.0; } }
        public static void Foreground(IntPtr h) {
            if (IsIconic(h)) { ShowWindow(h, 9); Thread.Sleep(400); }
            if (GetForegroundWindow() == h) return;
            // 按一下 Alt 解除 Windows 的前景鎖定，再切換視窗。
            keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
            SetForegroundWindow(h); Thread.Sleep(250);
        }
        public static void Click(Point p, uint linePid, string what) {
            var sp = new POINT { X = p.X, Y = p.Y };
            if (Pid(WindowFromPoint(sp)) != linePid) throw new Exception("要點的「" + what + "」被其他視窗遮住了，請把 LINE 視窗露出來再試。");
            SetCursorPos(p.X, p.Y); Thread.Sleep(60);
            mouse_event(2, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(40); mouse_event(4, 0, 0, 0, UIntPtr.Zero);
        }
        public static void Wheel(Point p, int delta) { SetCursorPos(p.X, p.Y); Thread.Sleep(40); mouse_event(0x800, 0, 0, unchecked((uint)delta), UIntPtr.Zero); }
        public static void Escape() { keybd_event(0x1B, 0, 0, UIntPtr.Zero); keybd_event(0x1B, 0, 2, UIntPtr.Zero); }
        public static Bitmap Capture(Rectangle r) {
            var b = new Bitmap(Math.Max(1, r.Width), Math.Max(1, r.Height));
            using (var g = Graphics.FromImage(b)) g.CopyFromScreen(r.Location, Point.Empty, b.Size, CopyPixelOperation.SourceCopy);
            return b;
        }
    }

    sealed class OcrLine { public string Text; public RectangleF Box; }

    sealed class Ocr {
        readonly OcrEngine engine;
        public Ocr() {
            engine = OcrEngine.TryCreateFromLanguage(new Language("zh-Hant-TW")) ?? OcrEngine.TryCreateFromUserProfileLanguages();
            if (engine == null) throw new Exception("Windows 沒有可用的 OCR 語言，請到「設定 > 時間與語言 > 語言」安裝繁體中文（含光學字元辨識）。");
        }
        static T Wait<T>(Windows.Foundation.IAsyncOperation<T> op) {
            var info = (Windows.Foundation.IAsyncInfo)op;
            while (info.Status == Windows.Foundation.AsyncStatus.Started) Thread.Sleep(10);
            if (info.Status != Windows.Foundation.AsyncStatus.Completed) throw new Exception("OCR 失敗");
            return op.GetResults();
        }
        // 回傳的座標是螢幕座標。
        public List<OcrLine> Read(Rectangle screen) {
            if (screen.Width < 4 || screen.Height < 4) return new List<OcrLine>();
            using (var src = N.Capture(screen)) {
                double scale = Math.Min(3.0, (double)OcrEngine.MaxImageDimension / Math.Max(src.Width, src.Height));
                if (scale < 1) scale = 1;
                using (var big = new Bitmap((int)(src.Width * scale), (int)(src.Height * scale)))
                using (var ms = new MemoryStream()) {
                    using (var g = Graphics.FromImage(big)) { g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic; g.DrawImage(src, 0, 0, big.Width, big.Height); }
                    big.Save(ms, ImageFormat.Png);
                    using (var stream = new InMemoryRandomAccessStream()) {
                        using (var w = new DataWriter(stream.GetOutputStreamAt(0))) { w.WriteBytes(ms.ToArray()); Wait(w.StoreAsync()); Wait(w.FlushAsync()); w.DetachStream(); }
                        stream.Seek(0);
                        var dec = Wait(BitmapDecoder.CreateAsync(stream));
                        using (var sb = Wait(dec.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied))) {
                            var res = Wait(engine.RecognizeAsync(sb));
                            return res.Lines.Where(l => l.Words.Count > 0).Select(l => {
                                double x0 = l.Words.Min(x => x.BoundingRect.X), y0 = l.Words.Min(x => x.BoundingRect.Y);
                                double x1 = l.Words.Max(x => x.BoundingRect.X + x.BoundingRect.Width), y1 = l.Words.Max(x => x.BoundingRect.Y + x.BoundingRect.Height);
                                return new OcrLine { Text = l.Text, Box = new RectangleF((float)(screen.X + x0 / scale), (float)(screen.Y + y0 / scale), (float)((x1 - x0) / scale), (float)((y1 - y0) / scale)) };
                            }).OrderBy(l => l.Box.Top).ToList();
                        }
                    }
                }
            }
        }
        public string Text(Rectangle screen) { return Txt.Join(Read(screen).Select(l => l.Text)); }
    }

    static class Txt {
        // Windows OCR 會在中文字之間插空白，把它們拿掉；英文單字間的空白保留。
        public static string Fix(string s) {
            s = (s ?? "").Trim();
            s = Regex.Replace(s, @"(?<=[\p{IsCJKUnifiedIdeographs}\p{IsCJKSymbolsandPunctuation}\p{IsHalfwidthandFullwidthForms}])\s+(?=[\p{IsCJKUnifiedIdeographs}\p{IsCJKSymbolsandPunctuation}\p{IsHalfwidthandFullwidthForms}])", "");
            s = Regex.Replace(s, @"(?<=\d)\s*([/:\-._])\s*(?=\d)", "$1");
            s = Regex.Replace(s, @"(?<=\d)\s+(?=[\p{IsCJKUnifiedIdeographs}])", "");
            s = Regex.Replace(s, @"(?<=[\p{IsCJKUnifiedIdeographs}])\s+(?=\d)", "");
            return s;
        }
        public static string Join(IEnumerable<string> lines) { return Fix(string.Join(" ", lines)); }
        public static string Compact(string s) { return Regex.Replace((s ?? "").Normalize(NormalizationForm.FormKC), @"\s+", ""); }
        // 「16張照片」→16；「照片 12 張・影片 3 部」→15。讀不到回傳 -1。
        public static int Count(string s) {
            s = Compact(s).Replace('O', '0').Replace('o', '0').Replace('l', '1').Replace('I', '1');
            var ms = Regex.Matches(s, @"\d+");
            if (ms.Count == 0) return -1;
            int total = 0; foreach (Match m in ms) { int v; if (int.TryParse(m.Value, out v)) total += v; }
            return total;
        }
        public static bool IsSaveAll(string s) {
            s = Compact(s);
            return (s.Contains("全部") && (s.Contains("儲") || s.Contains("存") || s.Contains("保"))) || s.Contains("儲存全") || s.ToLowerInvariant().Contains("saveall");
        }
        public static string SafeFolder(string name) {
            string r = (name ?? "").Replace("/", "").Replace("\\", "");
            r = Regex.Replace(r, "[<>:\"|?*\\x00-\\x1f]", "_").Trim().TrimEnd('.', ' ');
            if (r.Length == 0) r = "未命名相簿";
            if (Regex.IsMatch(r, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$", RegexOptions.IgnoreCase)) r = "_" + r;
            if (r.Length > 80) r = r.Substring(0, 80);
            return r;
        }
        public static string Csv(object o) { return "\"" + (o == null ? "" : o.ToString()).Replace("\"", "\"\"") + "\""; }
    }

    static class Ui {
        public static readonly string[] TempExt = { ".tmp", ".part", ".crdownload", ".download", ".partial" };
        public static Rectangle R(AutomationElement e) {
            var b = e.Current.BoundingRectangle;
            if (b.IsEmpty || double.IsInfinity(b.Width)) return Rectangle.Empty;
            return new Rectangle((int)Math.Round(b.X), (int)Math.Round(b.Y), (int)Math.Round(b.Width), (int)Math.Round(b.Height));
        }
        public static List<uint> LinePids() { return Process.GetProcessesByName("LINE").Select(p => (uint)p.Id).ToList(); }
        public static List<AutomationElement> TopWindows() {
            var list = new List<AutomationElement>();
            foreach (var pid in LinePids())
                foreach (AutomationElement e in AutomationElement.RootElement.FindAll(TreeScope.Children, new PropertyCondition(AutomationElement.ProcessIdProperty, (int)pid)))
                    list.Add(e);
            return list;
        }
        public static List<AutomationElement> TopWindows(string cls) {
            return TopWindows().Where(e => { try { return e.Current.ClassName == cls; } catch { return false; } }).ToList();
        }
        public static List<AutomationElement> Find(AutomationElement root, string cls, TreeScope scope = TreeScope.Descendants) {
            var list = new List<AutomationElement>();
            foreach (AutomationElement e in root.FindAll(scope, new PropertyCondition(AutomationElement.ClassNameProperty, cls))) list.Add(e);
            return list;
        }
        public static AutomationElement First(AutomationElement root, string cls) {
            return root.FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ClassNameProperty, cls));
        }
        public static IntPtr Hwnd(AutomationElement e) { return new IntPtr(e.Current.NativeWindowHandle); }
        public static int CountFiles(string folder) {
            if (!Directory.Exists(folder)) return 0;
            int n = 0;
            foreach (var f in Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories)) {
                string ext = Path.GetExtension(f).ToLowerInvariant();
                if (TempExt.Contains(ext) || Path.GetFileName(f).StartsWith("~")) continue;
                try { if (new FileInfo(f).Length == 0) continue; } catch { continue; }
                n++;
            }
            return n;
        }
    }

    sealed class LineWindow {
        public IntPtr Hwnd; public string Kind; public string Label; public bool IsOverview; public bool OnAlbumTab = true;
        public override string ToString() { return Label; }
    }

    static class Detect {
        // 相簿總覽的群組名稱：標題列下方、頁籤上方的那段文字。
        public static Rectangle GroupNameRect(AutomationElement win) {
            var tab = Ui.First(win, "GroupHomeTabPanel");
            int limit = tab != null ? Ui.R(tab).Top : int.MaxValue;
            var t = Ui.Find(win, "LcText").Select(Ui.R).Where(r => r.Height > 0 && r.Bottom <= limit + 2).OrderByDescending(r => r.Width * r.Height).FirstOrDefault();
            return t;
        }
        // 頁籤底下那條短線在左半邊＝目前在「相簿」頁籤。
        public static bool OnAlbumTab(AutomationElement win) {
            var tab = Ui.First(win, "GroupHomeTabPanel");
            if (tab == null) return true;
            var tr = Ui.R(tab);
            var under = Ui.Find(tab, "LcLine").Select(Ui.R).Where(r => r.Height <= 6 && r.Width < tr.Width / 2).ToList();
            if (under.Count == 0) return true;
            return under[0].Left + under[0].Width / 2 < tr.Left + tr.Width / 2;
        }
        public static List<LineWindow> Windows(Ocr ocr) {
            var result = new List<LineWindow>();
            foreach (var e in Ui.TopWindows()) {
                string cls; IntPtr h;
                try { cls = e.Current.ClassName; h = Ui.Hwnd(e); } catch { continue; }
                var w = new LineWindow { Hwnd = h, Kind = cls };
                bool min = N.IsIconic(h);
                if (cls == "GroupHomeWindow") {
                    w.IsOverview = true;
                    string name = "";
                    if (!min) { try { name = ocr.Text(GroupNameRect(e)); } catch { } w.OnAlbumTab = OnAlbumTab(e); }
                    if (name.Length == 0) name = "（名稱讀不到）";
                    w.Label = name + " 相簿" + (min ? "　（已最小化）" : "") + (w.OnAlbumTab ? "" : "　（目前在記事本頁籤）");
                } else if (cls == "ChatWindow") w.Label = N.Title(h) + "　（一般對話視窗）";
                else if (cls == "AllInOneWindow") w.Label = "LINE 主視窗　（聊天列表）";
                else if (cls == "AlbumDetailWindow") w.Label = "單本相簿視窗　（不是總覽）";
                else continue;
                result.Add(w);
            }
            return result.OrderByDescending(x => x.IsOverview).ToList();
        }
    }

    sealed class AlbumRow {
        public int No; public string Name = ""; public int Expected = -1; public int Actual; public string Status = ""; public string Folder = "";
    }

    sealed class Runner {
        readonly Ocr ocr; readonly Action<string> log; readonly Action<AlbumRow> report; readonly CancellationToken token;
        public int TimeoutSeconds = 600, StallSeconds = 90;
        uint pid; double scale;
        public Runner(Ocr o, Action<string> l, Action<AlbumRow> r, CancellationToken t) { ocr = o; log = l; report = r; token = t; }
        void Check() { token.ThrowIfCancellationRequested(); }
        void Sleep(int ms) { if (token.WaitHandle.WaitOne(ms)) token.ThrowIfCancellationRequested(); }

        public void Run(IntPtr overview, string dest) {
            if (!N.IsWindow(overview)) throw new Exception("選的 LINE 視窗已經關掉了，請按「重新整理」再選一次。");
            pid = N.Pid(overview); scale = N.Scale(overview);
            N.Foreground(overview); Sleep(300);
            var win = AutomationElement.FromHandle(overview);
            if (win.Current.ClassName != "GroupHomeWindow") throw new Exception("選的不是相簿總覽視窗。");
            if (!Detect.OnAlbumTab(win)) throw new Exception("相簿總覽目前在「記事本」頁籤，請先切到「相簿」。");
            var list = Ui.First(win, "LcListView");
            if (list == null) throw new Exception("相簿總覽裡找不到相簿清單。");
            var bar = Ui.First(win, "LcScrollBar");
            log("開始：從目前捲軸位置往下逐本處理。螢幕縮放 " + (int)(scale * 100) + "%。");

            var done = new List<double>(); int no = 0, noMove = 0; bool first = true;
            while (true) {
                Check();
                if (!N.IsWindow(overview)) throw new Exception("相簿總覽視窗被關掉了。");
                var lr = Ui.R(list); double max; double v = ScrollValue(bar, out max);
                var items = new List<AutomationElement>();
                foreach (AutomationElement it in list.FindAll(TreeScope.Children, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ListItem))) items.Add(it);
                AutomationElement next = null; Rectangle nextBand = Rectangle.Empty; double nextAbs = 0;
                foreach (var it in items.OrderBy(i => Ui.R(i).Top)) {
                    var r = Ui.R(it); if (r.Height < 100 * scale) continue;
                    double abs = v + (r.Top - lr.Top) / scale;
                    if (done.Any(d => Math.Abs(d - abs) < 30)) continue;
                    var band = NameBand(r);
                    if (band.Top < lr.Top) { if (first) done.Add(abs); continue; } // 名稱已經捲到上面看不到：屬於「目前位置之前」
                    if (band.Bottom > lr.Bottom) break; // 名稱還沒完整出現，先往下捲
                    next = it; nextBand = band; nextAbs = abs; break;
                }
                first = false;
                if (next != null) {
                    done.Add(nextAbs); no++;
                    var row = new AlbumRow { No = no };
                    try { DoAlbum(win, overview, nextBand, Ui.R(next), dest, row); }
                    catch (OperationCanceledException) { row.Status = "已停止"; report(row); throw; }
                    catch (Exception ex) { row.Status = "失敗：" + ex.Message; log("第 " + no + " 本失敗：" + ex.Message); CloseStray(); }
                    report(row);
                    N.Foreground(overview); Sleep(400);
                    continue;
                }
                if (bar == null || v >= max - 0.5) { log("已經捲到最底，掃描結束。"); break; }
                double step = Math.Max(60, lr.Height / scale * 0.5);
                if (!SetScroll(bar, Math.Min(max, v + step))) N.Wheel(new Point(lr.Left + lr.Width / 2, lr.Top + lr.Height / 2), -120);
                Sleep(500);
                double v2 = ScrollValue(bar, out max);
                if (Math.Abs(v2 - v) < 0.5) { if (++noMove >= 4) { log("捲軸連續 4 次沒有移動，停止。"); break; } }
                else noMove = 0;
            }
        }

        // 相簿卡片下緣的名稱＋張數區（避開右邊的 ⋮）。
        Rectangle NameBand(Rectangle item) {
            int h = (int)(56 * scale);
            return new Rectangle(item.Left + (int)(8 * scale), item.Bottom - h, item.Width - (int)(60 * scale), h - (int)(2 * scale));
        }

        static double ScrollValue(AutomationElement bar, out double max) {
            max = 0; if (bar == null) return 0;
            object p; if (!bar.TryGetCurrentPattern(RangeValuePattern.Pattern, out p)) return 0;
            var rv = (RangeValuePattern)p; max = rv.Current.Maximum; return rv.Current.Value;
        }
        static bool SetScroll(AutomationElement bar, double value) {
            try { object p; if (!bar.TryGetCurrentPattern(RangeValuePattern.Pattern, out p)) return false; ((RangeValuePattern)p).SetValue(value); return true; } catch { return false; }
        }

        void DoAlbum(AutomationElement overviewEl, IntPtr overview, Rectangle band, Rectangle item, string dest, AlbumRow row) {
            // 1. 點總覽上的相簿名稱
            var lines = ocr.Read(band);
            string listName = lines.Count > 0 ? Txt.Fix(lines[0].Text) : "";
            Point clickAt = lines.Count > 0
                ? new Point((int)(lines[0].Box.Left + Math.Min(lines[0].Box.Width / 2, 60 * scale)), (int)(lines[0].Box.Top + lines[0].Box.Height / 2))
                : new Point(item.Left + (int)(40 * scale), item.Bottom - (int)(31 * scale));
            log("第 " + row.No + " 本：點「" + (listName.Length > 0 ? listName : "（名稱）") + "」");
            var before = new HashSet<IntPtr>(Ui.TopWindows("AlbumDetailWindow").Select(Ui.Hwnd));
            N.Foreground(overview);
            N.Click(clickAt, pid, "相簿名稱");
            AutomationElement detail = WaitWindow("AlbumDetailWindow", before, 15000);
            if (detail == null) throw new Exception("點了相簿名稱，但 15 秒內沒有開出單本相簿視窗。");
            IntPtr dh = Ui.Hwnd(detail);
            try {
                Sleep(1200);
                // 2. 讀單本相簿的標題與張數
                var bar = Ui.First(detail, "LcTitleBar"); int barBottom = bar != null ? Ui.R(bar).Bottom : Ui.R(detail).Top;
                var texts = Ui.Find(detail, "LcText").Select(Ui.R).Where(r => r.Height > 0 && r.Top >= barBottom).OrderBy(r => r.Top).ThenBy(r => r.Left).ToList();
                if (texts.Count < 2) throw new Exception("單本相簿視窗讀不到標題與張數的位置。");
                string title = ocr.Text(Pad(texts[0], 4));
                int expected = Txt.Count(ocr.Text(Pad(texts[1], 4)));
                if (title.Length == 0) title = listName;
                row.Name = title; row.Expected = expected;
                log("　相簿名稱：" + (title.Length > 0 ? title : "（讀不到）") + "，" + (expected >= 0 ? expected + " 張" : "張數讀不到"));

                // 3. 決定資料夾；同名且張數相符就略過
                string folder = Path.Combine(dest, Txt.SafeFolder(title.Length > 0 ? title : "相簿_" + row.No));
                if (Directory.Exists(folder)) {
                    int have = Ui.CountFiles(folder);
                    if (expected > 0 && have == expected) {
                        row.Folder = folder; row.Actual = have; row.Status = "略過（已下載過，張數相符）";
                        log("　" + row.Status); return;
                    }
                    string stem = folder; int k = 2;
                    while (Directory.Exists(folder) && Ui.CountFiles(folder) > 0) folder = stem + " (" + k++ + ")";
                }
                Directory.CreateDirectory(folder); row.Folder = folder;
                report(row);

                // 4. 右上角 ⋮ → 儲存全部
                ClickSaveAll(detail);
                // 5. 資料夾對話框填入路徑
                FillFolderDialog(folder);
                // 6. 等檔案存完並核對張數
                row.Status = "下載中…"; report(row);
                row.Actual = WaitFiles(folder, expected, row);
                if (expected > 0 && row.Actual >= expected) row.Status = row.Actual == expected ? "完成 ✔" : "完成（多 " + (row.Actual - expected) + " 個檔）";
                else if (expected > 0) row.Status = "不完整 " + row.Actual + "/" + expected;
                else row.Status = row.Actual > 0 ? "完成（張數無法核對）" : "失敗：資料夾是空的";
                log("　" + row.Status + "　→ " + folder);
            } finally {
                CloseDetail(dh);
            }
        }

        static Rectangle Pad(Rectangle r, int p) { return new Rectangle(r.X - p, r.Y - p, r.Width + p * 2, r.Height + p * 2); }

        AutomationElement WaitWindow(string cls, HashSet<IntPtr> before, int ms) {
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < ms) {
                Check();
                var w = Ui.TopWindows(cls).FirstOrDefault(e => !before.Contains(Ui.Hwnd(e)));
                if (w != null) return w;
                Sleep(250);
            }
            return null;
        }

        void ClickSaveAll(AutomationElement detail) {
            var dr = Ui.R(detail);
            var bar = Ui.First(detail, "LcTitleBar"); int top = bar != null ? Ui.R(bar).Bottom - 2 : dr.Top;
            var scroll = Ui.First(detail, "LcScrollArea"); int bottom = scroll != null ? Ui.R(scroll).Top + 2 : dr.Top + (int)(120 * scale);
            var dots = Ui.Find(detail, "LcButton").Select(Ui.R).Where(r => r.Top >= top && r.Bottom <= bottom && r.Width > 0).OrderByDescending(r => r.Right).FirstOrDefault();
            if (dots.IsEmpty) throw new Exception("找不到單本相簿右上角的 ⋮ 按鈕。");
            for (int attempt = 1; attempt <= 3; attempt++) {
                Check();
                var before = new HashSet<IntPtr>(Ui.TopWindows("LcContextMenu").Select(Ui.Hwnd));
                N.Foreground(Ui.Hwnd(detail));
                N.Click(new Point(dots.Left + dots.Width / 2, dots.Top + dots.Height / 2), pid, "⋮");
                var menu = WaitWindow("LcContextMenu", before, 4000);
                if (menu == null) { log("　⋮ 選單沒有出現，重試（" + attempt + "/3）"); N.Escape(); Sleep(500); continue; }
                Sleep(300);
                var items = Ui.Find(menu, "LcContextMenuItem").Select(Ui.R).Where(r => r.Height > 0).OrderBy(r => r.Top).ToList();
                var lines = ocr.Read(Ui.R(menu));
                Rectangle target = Rectangle.Empty;
                foreach (var it in items) {
                    var hit = lines.FirstOrDefault(l => { float cy = l.Box.Top + l.Box.Height / 2; return cy >= it.Top && cy <= it.Bottom; });
                    if (hit != null && Txt.IsSaveAll(hit.Text)) { target = it; break; }
                }
                if (target.IsEmpty && items.Count == 5) {
                    target = items[2];
                    log("　選單文字沒讀到「儲存全部」，依位置點第 3 項。");
                }
                if (target.IsEmpty) { log("　選單裡找不到「儲存全部」（讀到：" + string.Join("、", lines.Select(l => Txt.Fix(l.Text))) + "），重試"); N.Escape(); Sleep(500); continue; }
                N.Click(new Point(target.Left + target.Width / 3, target.Top + target.Height / 2), pid, "儲存全部");
                log("　已按「儲存全部」");
                return;
            }
            throw new Exception("按 ⋮ 三次都沒能點到「儲存全部」。");
        }

        // LINE 按「儲存全部」後會跳出 Windows 的「選擇資料夾」視窗：路徑框 ID 1152、確認鈕 ID 1。
        void FillFolderDialog(string folder) {
            AutomationElement edit = null; var sw = Stopwatch.StartNew();
            var cond = new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit), new PropertyCondition(AutomationElement.AutomationIdProperty, "1152"));
            while (edit == null && sw.ElapsedMilliseconds < 12000) {
                Check();
                foreach (var w in Ui.TopWindows()) { try { edit = w.FindFirst(TreeScope.Descendants, cond); } catch { } if (edit != null) break; }
                if (edit == null) Sleep(300);
            }
            if (edit == null) throw new Exception("按了「儲存全部」，但 12 秒內沒有出現選擇資料夾的視窗。");
            Sleep(300);
            object vp; if (!edit.TryGetCurrentPattern(ValuePattern.Pattern, out vp)) throw new Exception("資料夾視窗的路徑欄無法自動填入。");
            ((ValuePattern)vp).SetValue(folder); Sleep(200);
            AutomationElement node = edit, ok = null;
            var okCond = new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button), new PropertyCondition(AutomationElement.AutomationIdProperty, "1"));
            for (int up = 0; up < 10 && ok == null && node != null; up++) { ok = node.FindFirst(TreeScope.Descendants, okCond); if (ok == null) node = TreeWalker.ControlViewWalker.GetParent(node); }
            if (ok == null) throw new Exception("資料夾視窗找不到「選擇資料夾」按鈕。");
            object ip; if (!ok.TryGetCurrentPattern(InvokePattern.Pattern, out ip)) throw new Exception("「選擇資料夾」按鈕無法操作。");
            ((InvokePattern)ip).Invoke();
            log("　已選定資料夾，LINE 開始儲存");
            Sleep(800);
        }

        int WaitFiles(string folder, int expected, AlbumRow row) {
            var sw = Stopwatch.StartNew(); int last = -1; long lastChange = 0, lastReport = 0;
            while (true) {
                Check();
                int n = Ui.CountFiles(folder); long t = sw.ElapsedMilliseconds;
                if (n != last) { last = n; lastChange = t; }
                if (t - lastReport > 1500) { row.Actual = n; row.Status = "下載中… " + n + (expected > 0 ? "/" + expected : ""); report(row); lastReport = t; }
                long quiet = t - lastChange;
                if (expected > 0 && n >= expected && quiet >= 3000) return n;
                if (expected <= 0 && n > 0 && quiet >= 10000) return n;
                if (quiet >= StallSeconds * 1000L) { log("　檔案數 " + StallSeconds + " 秒沒有增加，不再等待。"); return n; }
                if (t >= TimeoutSeconds * 1000L) { log("　超過每本上限 " + TimeoutSeconds + " 秒，不再等待。"); return n; }
                Sleep(1000);
            }
        }

        void CloseDetail(IntPtr h) {
            if (!N.IsWindow(h)) return;
            N.PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
            for (int i = 0; i < 20 && N.IsWindow(h); i++) Thread.Sleep(150);
            if (N.IsWindow(h)) { N.Foreground(h); N.Escape(); Thread.Sleep(300); }
        }
        void CloseStray() {
            try { foreach (var m in Ui.TopWindows("LcContextMenu")) N.Escape(); } catch { }
        }
    }

    sealed class MainForm : Form {
        readonly ComboBox windows = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
        readonly Button refresh = new Button { Text = "重新整理" };
        readonly TextBox dest = new TextBox { Dock = DockStyle.Fill, ReadOnly = true };
        readonly Button browse = new Button { Text = "選擇資料夾" };
        readonly Button start = new Button { Text = "▼ 逐步往下掃描並儲存" };
        readonly Button stop = new Button { Text = "停止 (F8)", Enabled = false };
        readonly Button recheck = new Button { Text = "重新核對張數" };
        readonly NumericUpDown timeout = new NumericUpDown { Minimum = 60, Maximum = 7200, Value = 600, Increment = 60, Width = 80 };
        readonly Label hint = new Label { AutoSize = true, ForeColor = Color.FromArgb(90, 98, 110) };
        readonly DataGridView grid = new DataGridView { Dock = DockStyle.Fill, ReadOnly = true, AllowUserToAddRows = false, AllowUserToDeleteRows = false, RowHeadersVisible = false, SelectionMode = DataGridViewSelectionMode.FullRowSelect, BackgroundColor = Color.White, BorderStyle = BorderStyle.None, AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill };
        readonly TextBox logBox = new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = Color.FromArgb(247, 248, 250), BorderStyle = BorderStyle.None };
        readonly Label summary = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, Font = new Font("Microsoft JhengHei UI", 10f, FontStyle.Bold) };
        readonly List<AlbumRow> rows = new List<AlbumRow>();
        Ocr ocr; CancellationTokenSource cts; bool busy;
        static readonly Color Green = Color.FromArgb(6, 199, 85);
        static readonly string Settings = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "LineAlbumSaver.txt");

        public MainForm() {
            Text = "LINE 相簿批次儲存"; Font = new Font("Microsoft JhengHei UI", 9.5f); AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(820, 640); MinimumSize = new Size(640, 480); BackColor = Color.White; StartPosition = FormStartPosition.Manual;
            var wa = Screen.PrimaryScreen.WorkingArea; Location = new Point(Math.Max(wa.Left, wa.Right - Width - 10), wa.Top + 10);

            var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, Padding = new Padding(14) };
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 62));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 38));
            Controls.Add(root);

            root.Controls.Add(Line("① LINE 視窗", windows, refresh));
            root.Controls.Add(Line("② 儲存資料夾", dest, browse));
            var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true, Margin = new Padding(0, 6, 0, 4) };
            foreach (var b in new[] { start, stop, recheck }) { b.AutoSize = true; b.Padding = new Padding(10, 4, 10, 4); b.FlatStyle = FlatStyle.Flat; b.Margin = new Padding(0, 0, 8, 0); actions.Controls.Add(b); }
            start.BackColor = Green; start.ForeColor = Color.White; start.FlatAppearance.BorderSize = 0; start.Font = new Font(Font, FontStyle.Bold);
            stop.FlatAppearance.BorderColor = Color.FromArgb(200, 80, 80); recheck.FlatAppearance.BorderColor = Color.Silver;
            actions.Controls.Add(new Label { Text = "每本最長等待(秒)", AutoSize = true, Margin = new Padding(12, 8, 4, 0) });
            actions.Controls.Add(timeout);
            root.Controls.Add(actions);
            hint.Text = "先在 LINE 打開群組的「相簿」總覽，捲到要開始的位置。執行中請勿動滑鼠，按 F8 可隨時停止。";
            hint.Margin = new Padding(0, 0, 0, 6);
            root.Controls.Add(hint);
            root.Controls.Add(summary);

            grid.Columns.Add("no", "#"); grid.Columns.Add("name", "相簿名稱"); grid.Columns.Add("exp", "應有"); grid.Columns.Add("act", "實際"); grid.Columns.Add("st", "狀態"); grid.Columns.Add("dir", "資料夾");
            grid.Columns[0].FillWeight = 8; grid.Columns[1].FillWeight = 40; grid.Columns[2].FillWeight = 10; grid.Columns[3].FillWeight = 10; grid.Columns[4].FillWeight = 28; grid.Columns[5].FillWeight = 40;
            grid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(240, 244, 242); grid.EnableHeadersVisualStyles = false;
            grid.CellDoubleClick += (s, e) => { if (e.RowIndex >= 0 && e.RowIndex < rows.Count && Directory.Exists(rows[e.RowIndex].Folder)) Process.Start("explorer.exe", "\"" + rows[e.RowIndex].Folder + "\""); };
            root.Controls.Add(grid);
            root.Controls.Add(logBox);

            refresh.Click += (s, e) => RefreshWindows();
            browse.Click += (s, e) => {
                using (var d = new FolderBrowserDialog { Description = "選擇相簿要存放的資料夾（每本相簿會建一個子資料夾）", ShowNewFolderButton = true, SelectedPath = dest.Text })
                    if (d.ShowDialog(this) == DialogResult.OK) { dest.Text = d.SelectedPath; try { File.WriteAllText(Settings, d.SelectedPath, Encoding.UTF8); } catch { } }
            };
            windows.SelectedIndexChanged += (s, e) => UpdateButtons();
            start.Click += (s, e) => Start();
            stop.Click += (s, e) => { if (cts != null) { cts.Cancel(); Log("收到停止指令，處理完目前動作後停止。"); } };
            recheck.Click += (s, e) => Recheck();
            try { if (File.Exists(Settings)) dest.Text = File.ReadAllText(Settings, Encoding.UTF8).Trim(); } catch { }
            Shown += (s, e) => { N.RegisterHotKey(Handle, 1, 0, (uint)Keys.F8); RefreshWindows(); };
            FormClosed += (s, e) => N.UnregisterHotKey(Handle, 1);
        }

        Control Line(string label, Control main, Button side) {
            var p = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, AutoSize = true, Margin = new Padding(0, 2, 0, 2) };
            p.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 104)); p.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); p.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            p.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left, Font = new Font(Font, FontStyle.Bold) }, 0, 0);
            main.Margin = new Padding(0, 3, 8, 3); p.Controls.Add(main, 1, 0);
            side.AutoSize = true; side.FlatStyle = FlatStyle.Flat; side.FlatAppearance.BorderColor = Color.Silver; p.Controls.Add(side, 2, 0);
            return p;
        }

        protected override void WndProc(ref Message m) {
            if (m.Msg == 0x0312 && m.WParam.ToInt32() == 1 && cts != null) { cts.Cancel(); Log("F8：停止中…"); }
            base.WndProc(ref m);
        }

        void Log(string s) {
            if (InvokeRequired) { BeginInvoke(new Action<string>(Log), s); return; }
            logBox.AppendText(DateTime.Now.ToString("HH:mm:ss") + "  " + s + Environment.NewLine);
        }

        void Report(AlbumRow r) {
            if (InvokeRequired) { BeginInvoke(new Action<AlbumRow>(Report), r); return; }
            int i = rows.IndexOf(r);
            if (i < 0) { rows.Add(r); i = grid.Rows.Add(); }
            var g = grid.Rows[i];
            g.SetValues(r.No, r.Name, r.Expected >= 0 ? r.Expected.ToString() : "?", r.Actual, r.Status, r.Folder);
            g.DefaultCellStyle.BackColor = r.Status.StartsWith("完成") ? Color.FromArgb(232, 248, 238) : r.Status.StartsWith("略過") ? Color.FromArgb(242, 244, 247)
                : (r.Status.StartsWith("失敗") || r.Status.StartsWith("不完整")) ? Color.FromArgb(253, 236, 234) : Color.White;
            grid.FirstDisplayedScrollingRowIndex = Math.Max(0, i - 3);
            UpdateSummary();
        }

        void UpdateSummary() {
            int ok = rows.Count(r => r.Status.StartsWith("完成")), skip = rows.Count(r => r.Status.StartsWith("略過")), bad = rows.Count(r => r.Status.StartsWith("失敗") || r.Status.StartsWith("不完整"));
            summary.Text = "共 " + rows.Count + " 本　✔ 完成 " + ok + "　略過 " + skip + "　✘ 失敗/不完整 " + bad;
            summary.ForeColor = bad > 0 ? Color.FromArgb(190, 50, 40) : Color.FromArgb(20, 110, 60);
        }

        void RefreshWindows() {
            if (busy) return;
            Cursor = Cursors.WaitCursor; windows.Items.Clear();
            try {
                if (ocr == null) ocr = new Ocr();
                var list = Detect.Windows(ocr);
                foreach (var w in list) windows.Items.Add(w);
                if (list.Count == 0) Log("找不到 LINE 視窗，請先開啟並登入電腦版 LINE。");
                var firstOverview = list.FirstOrDefault(w => w.IsOverview);
                if (firstOverview != null) windows.SelectedItem = firstOverview; else if (list.Count > 0) windows.SelectedIndex = 0;
                if (firstOverview == null && list.Count > 0) Log("目前沒有開著的相簿總覽。請在群組選單點「相簿」，打開後按「重新整理」。");
            } catch (Exception ex) { Log("讀取視窗失敗：" + ex.Message); }
            finally { Cursor = Cursors.Default; UpdateButtons(); }
        }

        void UpdateButtons() {
            var w = windows.SelectedItem as LineWindow;
            start.Enabled = !busy && w != null && w.IsOverview && w.OnAlbumTab;
            stop.Enabled = busy; refresh.Enabled = browse.Enabled = recheck.Enabled = windows.Enabled = !busy;
            if (!busy && w != null && !w.IsOverview) hint.Text = "這個是「" + w.Label.Trim() + "」，不是相簿總覽。請選名稱後面是「相簿」的那一個。";
            else if (!busy && w != null && !w.OnAlbumTab) hint.Text = "相簿總覽目前在「記事本」頁籤，請在 LINE 切到「相簿」再按重新整理。";
            else if (!busy) hint.Text = "先在 LINE 打開群組的「相簿」總覽，捲到要開始的位置。執行中請勿動滑鼠，按 F8 可隨時停止。";
        }

        async void Start() {
            var w = windows.SelectedItem as LineWindow;
            if (w == null || !w.IsOverview) return;
            if (string.IsNullOrWhiteSpace(dest.Text) || !Directory.Exists(dest.Text)) { MessageBox.Show(this, "請先選擇儲存資料夾。", "LINE 相簿批次儲存"); return; }
            busy = true; cts = new CancellationTokenSource(); UpdateButtons();
            hint.Text = "執行中，請勿動滑鼠或鍵盤。按 F8 停止。";
            string root = dest.Text; var token = cts.Token; int secs = (int)timeout.Value;
            WindowState = FormWindowState.Minimized;
            try {
                await Task.Run(() => {
                    var runner = new Runner(ocr, Log, Report, token) { TimeoutSeconds = secs };
                    runner.Run(w.Hwnd, root);
                });
                Log("全部處理完畢。");
            } catch (OperationCanceledException) { Log("已停止。"); }
            catch (Exception ex) { Log("停止：" + ex.Message); MessageBox.Show(this, ex.Message, "已停止"); }
            finally {
                busy = false; cts = null; WindowState = FormWindowState.Normal; Activate(); UpdateButtons();
                SaveReport(root);
            }
        }

        void Recheck() {
            foreach (var r in rows) {
                if (!Directory.Exists(r.Folder)) continue;
                r.Actual = Ui.CountFiles(r.Folder);
                if (r.Expected > 0) r.Status = r.Actual >= r.Expected ? (r.Actual == r.Expected ? "完成 ✔" : "完成（多 " + (r.Actual - r.Expected) + " 個檔）") : "不完整 " + r.Actual + "/" + r.Expected;
                Report(r);
            }
            Log("已重新核對 " + rows.Count + " 本的檔案數。");
            if (rows.Count > 0) SaveReport(dest.Text);
        }

        void SaveReport(string root) {
            if (rows.Count == 0 || !Directory.Exists(root)) return;
            try {
                string path = Path.Combine(root, "LINE相簿下載核對_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") + ".csv");
                var sb = new StringBuilder("序號,相簿名稱,應有張數,實際檔案數,結果,資料夾\r\n");
                foreach (var r in rows) sb.Append(string.Join(",", new object[] { r.No, Txt.Csv(r.Name), r.Expected >= 0 ? r.Expected.ToString() : "", r.Actual, Txt.Csv(r.Status), Txt.Csv(r.Folder) })).Append("\r\n");
                File.WriteAllText(path, sb.ToString(), new UTF8Encoding(true));
                Log("核對表已存：" + path);
            } catch (Exception ex) { Log("核對表儲存失敗：" + ex.Message); }
        }
    }

    static class Program {
        [STAThread]
        static void Main(string[] args) {
            N.SetProcessDPIAware();
            if (args.Length > 0 && args[0] == "--probe") { Probe(args.Length > 1 ? args[1] : "probe.txt"); return; }
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
        // 不點擊任何東西：列出視窗判斷結果，並讀出總覽目前畫面上每本相簿的名稱區。
        static void Probe(string outPath) {
            var o = new StringBuilder();
            try {
                var ocr = new Ocr();
                foreach (var w in Detect.Windows(ocr)) o.AppendLine("[" + w.Kind + "] " + w.Label + (w.IsOverview ? " ← 可選" : ""));
                foreach (var win in Ui.TopWindows("GroupHomeWindow")) {
                    double scale = N.Scale(Ui.Hwnd(win));
                    var list = Ui.First(win, "LcListView"); var bar = Ui.First(win, "LcScrollBar");
                    object p; string sv = "無捲軸";
                    if (bar != null && bar.TryGetCurrentPattern(RangeValuePattern.Pattern, out p)) sv = ((RangeValuePattern)p).Current.Value + " / " + ((RangeValuePattern)p).Current.Maximum;
                    o.AppendLine("總覽 scale=" + scale + " 捲軸=" + sv + " 清單=" + Ui.R(list));
                    foreach (AutomationElement it in list.FindAll(TreeScope.Children, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ListItem))) {
                        var r = Ui.R(it); int h = (int)(56 * scale);
                        var band = new Rectangle(r.Left + (int)(8 * scale), r.Bottom - h, r.Width - (int)(60 * scale), h - (int)(2 * scale));
                        o.AppendLine("  項目 " + r + " 名稱區 → " + string.Join(" | ", ocr.Read(band).Select(l => Txt.Fix(l.Text) + " @" + (int)l.Box.X + "," + (int)l.Box.Y)));
                    }
                }
                foreach (var win in Ui.TopWindows("AlbumDetailWindow")) {
                    var bar = Ui.First(win, "LcTitleBar"); int bb = bar != null ? Ui.R(bar).Bottom : 0;
                    var t = Ui.Find(win, "LcText").Select(Ui.R).Where(r => r.Height > 0 && r.Top >= bb).OrderBy(r => r.Top).ToList();
                    o.AppendLine("單本相簿：" + string.Join(" | ", t.Take(3).Select(r => ocr.Text(new Rectangle(r.X - 4, r.Y - 4, r.Width + 8, r.Height + 8)))));
                    if (t.Count > 1) o.AppendLine("  張數解析 = " + Txt.Count(ocr.Text(new Rectangle(t[1].X - 4, t[1].Y - 4, t[1].Width + 8, t[1].Height + 8))));
                }
                foreach (var menu in Ui.TopWindows("LcContextMenu")) {
                    var ocrLines = ocr.Read(Ui.R(menu));
                    o.AppendLine("選單：" + string.Join(" | ", ocrLines.Select(l => Txt.Fix(l.Text) + (Txt.IsSaveAll(l.Text) ? "(★儲存全部)" : ""))));
                }
            } catch (Exception ex) { o.AppendLine("ERROR " + ex); }
            File.WriteAllText(outPath, o.ToString(), new UTF8Encoding(true));
        }
    }
}
