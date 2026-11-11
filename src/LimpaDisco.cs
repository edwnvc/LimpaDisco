
                                // LimpaDisco - analisador de espaço em disco com exclusão segura.
// Compilar: dotnet publish -c Release -o app   (gera app\LimpaDisco.exe)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

class Node
{
    public string Name;           // na raiz: caminho completo
    public Node Parent;
    public long Size, Files;
    public List<Node> Children;   // null = arquivo
    public bool IsLink;           // junction/symlink: nunca entramos nele
    public int Id;                // id enviado para a interface (0 = ainda não enviado)
    public bool IsDir => Children != null;
    public string FullPath => Parent == null ? Name : Path.Combine(Parent.FullPath, Name);
}

static class Native
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WIN32_FIND_DATA
    {
        public uint dwFileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME ftCreationTime, ftLastAccessTime, ftLastWriteTime;
        public uint nFileSizeHigh, nFileSizeLow, dwReserved0, dwReserved1;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string cFileName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string cAlternateFileName;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr FindFirstFileExW(string name, int infoLevel, out WIN32_FIND_DATA data, int searchOp, IntPtr filter, int flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern bool FindNextFileW(IntPtr h, out WIN32_FIND_DATA data);
    [DllImport("kernel32.dll")] public static extern bool FindClose(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern uint GetFileAttributesW(string name);
    [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct SHFILEOPSTRUCT
    {
        public IntPtr hwnd; public uint wFunc; public string pFrom; public string pTo;
        public ushort fFlags; public bool fAnyOperationsAborted; public IntPtr hNameMappings; public string lpszProgressTitle;
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] public static extern int SHFileOperationW(ref SHFILEOPSTRUCT op);

    public static string LongPath(string p)
    {
        if (p.StartsWith(@"\\?\")) return p;
        return p.StartsWith(@"\\") ? @"\\?\UNC\" + p.Substring(2) : @"\\?\" + p;
    }
    public static bool Exists(string p) => GetFileAttributesW(LongPath(p)) != 0xFFFFFFFF;

    // Usa o próprio Shell do Windows (mesmo do Explorer): respeita a Lixeira, mostra progresso
    // e AVISA se algo for grande demais para a Lixeira em vez de apagar em silêncio.
    public static void ShellDelete(IntPtr owner, IEnumerable<string> paths, bool permanent)
    {
        const ushort FOF_NOCONFIRMATION = 0x10, FOF_ALLOWUNDO = 0x40, FOF_WANTNUKEWARNING = 0x4000;
        var op = new SHFILEOPSTRUCT
        {
            hwnd = owner, wFunc = 3 /* FO_DELETE */,
            pFrom = string.Join("\0", paths) + "\0",   // lista terminada em null duplo
            fFlags = permanent ? FOF_NOCONFIRMATION : (ushort)(FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_WANTNUKEWARNING),
        };
        SHFileOperationW(ref op);
    }
}

static class Scanner
{
    public static long Count, Denied;
    public static volatile bool Cancel;
    static readonly IntPtr INVALID = new IntPtr(-1);

    public static void Scan(Node dir, string path, int depth)
    {
        var subdirs = new List<Node>();
        // 1 = FindExInfoBasic (sem nome 8.3), 2 = FIND_FIRST_EX_LARGE_FETCH: bem mais rápido que a API padrão
        IntPtr h = Native.FindFirstFileExW(Native.LongPath(path.TrimEnd('\\')) + @"\*", 1, out var d, 0, IntPtr.Zero, 2);
        if (h == INVALID)
        {
            if (Marshal.GetLastWin32Error() == 5) Interlocked.Increment(ref Denied);
        }
        else
        {
            do
            {
                if (d.cFileName == "." || d.cFileName == "..") continue;
                var n = new Node { Name = d.cFileName, Parent = dir };
                if ((d.dwFileAttributes & 0x10) != 0)
                {
                    n.Children = new List<Node>();
                    n.IsLink = (d.dwFileAttributes & 0x400) != 0;  // não seguir junctions: evita contar em dobro e loops
                    if (!n.IsLink) subdirs.Add(n);
                }
                else
                {
                    n.Size = ((long)d.nFileSizeHigh << 32) | d.nFileSizeLow;
                    n.Files = 1;
                    Interlocked.Increment(ref Count);
                }
                dir.Children.Add(n);
            } while (!Cancel && Native.FindNextFileW(h, out d));
            Native.FindClose(h);
        }
        if (depth < 4) Parallel.ForEach(subdirs, s => Scan(s, Path.Combine(path, s.Name), depth + 1));
        else foreach (var s in subdirs) Scan(s, Path.Combine(path, s.Name), depth + 1);
        foreach (var c in dir.Children) { dir.Size += c.Size; dir.Files += c.Files; }
        dir.Children.Sort((a, b) => b.Size.CompareTo(a.Size));
    }
}

static class Safety
{
    static bool Under(string a, string b)
    {
        a = a.TrimEnd('\\'); b = b.TrimEnd('\\');
        return a.Equals(b, StringComparison.OrdinalIgnoreCase) || a.StartsWith(b + "\\", StringComparison.OrdinalIgnoreCase);
    }

    // Retorna o motivo do bloqueio, ou null se pode excluir.
    public static string WhyProtected(string path)
    {
        string full = Path.GetFullPath(path).TrimEnd('\\');
        string root = Path.GetPathRoot(full).TrimEnd('\\');
        if (full.Equals(root, StringComparison.OrdinalIgnoreCase)) return "é a raiz de um disco";

        // Nada dentro destas pastas pode ser apagado.
        var sysDrive = Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.Windows));
        var noTouch = new List<string> { Environment.GetFolderPath(Environment.SpecialFolder.Windows) };
        foreach (var r in new[] { root + "\\", sysDrive })
            foreach (var n in new[] { "$Recycle.Bin", "System Volume Information", "Recovery", "Boot", "EFI", "$WinREAgent", "$SysReset" })
                noTouch.Add(Path.Combine(r, n));
        foreach (var p in noTouch)
            if (Under(full, p)) return "é pasta de sistema (" + p + ")";

        // Estas pastas (e qualquer pasta que as contenha) não podem ser apagadas inteiras; subpastas podem.
        string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var whole = new List<string> {
            Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
            Environment.GetFolderPath(Environment.SpecialFolder.MyMusic),
            Environment.GetFolderPath(Environment.SpecialFolder.MyVideos),
            Path.Combine(profile, "Downloads"),
            profile,
        };
        foreach (var p in whole)
            if (p.Length > 0 && Under(p, full)) return "é ou contém uma pasta essencial (" + p + ")";
        return null;
    }

    public static int SelfTest()
    {
        string win = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var blocked = new[] { "C:\\", "D:\\", win, win + "\\System32", pf, profile, Path.GetDirectoryName(profile),
                              profile + "\\Downloads", profile + "\\AppData", "C:\\$Recycle.Bin\\x", "C:\\System Volume Information" };
        var allowed = new[] { profile + "\\Downloads\\algo", pf + "\\AlgumPrograma", profile + "\\AppData\\Local\\Temp", "D:\\Jogos", "C:\\Windowsx" };
        int fails = 0;
        foreach (var p in blocked) if (WhyProtected(p) == null) { fails++; Console.Error.WriteLine("deveria bloquear: " + p); }
        foreach (var p in allowed) if (WhyProtected(p) != null) { fails++; Console.Error.WriteLine("deveria permitir: " + p); }
        return fails;
    }
}

// Janela nativa só como moldura; toda a interface é o index.html dentro do WebView2.
class MainForm : Form
{
    static readonly Color Bg = Color.FromArgb(14, 14, 16);
    static readonly string ThemeFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LimpaDisco", "tema.txt");
    readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Bg };
    readonly Dictionary<int, Node> ids = new Dictionary<int, Node>();
    Node root;
    int nextId;
    bool busy;
    string status = "";

    public MainForm()
    {
        Text = "LimpaDisco";
        Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath);   // ícone do .exe também na janela e na barra de tarefas
        BackColor = Bg;
        ClientSize = LogicalToDeviceUnits(new Size(1240, 780));
        MinimumSize = LogicalToDeviceUnits(new Size(900, 560));
        var wa = Screen.FromPoint(Cursor.Position).WorkingArea;   // não passar do tamanho da tela
        Size = new Size(Math.Min(Width, wa.Width - 40), Math.Min(Height, wa.Height - 40));
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(web);
        Load += async (_, _) =>
        {
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(null,
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LimpaDisco"));
                await web.EnsureCoreWebView2Async(env);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                MessageBox.Show("Instale o Microsoft Edge WebView2 Runtime para usar o LimpaDisco.", "LimpaDisco");
                Close(); return;
            }
            var core = web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            // A página nunca sai do index.html: nada de navegar para sites ou abrir janelas.
            bool loaded = false;
            core.NavigationStarting += (_, e) => { if (loaded) e.Cancel = true; loaded = true; };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.WebMessageReceived += (_, e) => OnMessage(JsonDocument.Parse(e.WebMessageAsJson).RootElement);
            // Endereço interno: a página e o script vêm de dentro do .exe; /musica, /musica2 e /musica3 são as músicas das batalhas, também embutidas.
            core.AddWebResourceRequestedFilter(Host + "*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) =>
            {
                string name = Uri.UnescapeDataString(new Uri(e.Request.Uri).AbsolutePath.TrimStart('/'));
                if (name == "") name = "index.html";
                Stream body = null; string type = "text/html; charset=utf-8";
                var asm = typeof(MainForm).Assembly;
                if (name == "ritmo-lista")   // arquivos das músicas da batalha de ritmo (assets/ritmo/<pasta>/...)
                {
                    var list = asm.GetManifestResourceNames().Where(n => n.StartsWith("ritmo/")).Select(n => n.Replace('\\', '/'));
                    body = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(string.Join("\n", list))); type = "text/plain; charset=utf-8";
                }
                else body = asm.GetManifestResourceStream(name)   // só o que está embutido; nada do disco
                    ?? asm.GetManifestResourceStream(asm.GetManifestResourceNames().FirstOrDefault(n => n.Replace('\\', '/') == name) ?? "-");   // pastas das músicas vêm com "\" no nome
                if (name.EndsWith(".js")) type = "text/javascript; charset=utf-8";
                e.Response = body == null
                    ? core.Environment.CreateWebResourceResponse(null, 404, "Not Found", "")
                    : core.Environment.CreateWebResourceResponse(body, 200, "OK", "Content-Type: " + type + "\nCache-Control: no-store");   // sem cache: trocar a música ou atualizar o app vale na hora
            };
            core.Navigate(Host);
        };
    }

    const string Host = "https://limpadisco.local/";

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Barra de título escura e da mesma cor do app (Windows 11).
        int on = 1, caption = 0x00100E0E, text = 0x00F0EDED, border = 0x002C2828;   // COLORREF = 0x00BBGGRR
        Native.DwmSetWindowAttribute(Handle, 20, ref on, 4);
        Native.DwmSetWindowAttribute(Handle, 35, ref caption, 4);
        Native.DwmSetWindowAttribute(Handle, 36, ref text, 4);
        Native.DwmSetWindowAttribute(Handle, 34, ref border, 4);
    }

    void Send(object o) => web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(o));

    int IdOf(Node n) { if (n.Id == 0) { n.Id = ++nextId; ids[n.Id] = n; } return n.Id; }
    // Se uma pasta e algo dentro dela forem selecionados juntos, fica só a pasta (senão o tamanho seria descontado duas vezes).
    List<Node> NodesOf(JsonElement m)
    {
        var nodes = m.GetProperty("ids").EnumerateArray().Select(x => ids[x.GetInt32()]).Distinct().ToList();
        var set = new HashSet<Node>(nodes);
        return nodes.Where(n => { for (var a = n.Parent; a != null; a = a.Parent) if (set.Contains(a)) return false; return true; }).ToList();
    }

    async void OnMessage(JsonElement m)
    {
        string cmd = m.GetProperty("cmd").GetString();
        if (busy && cmd != "cancel") return;
        try
        {
            switch (cmd)
            {
                case "init":
                    SendDrives();
                    if (File.Exists(ThemeFile)) Send(new { type = "theme", name = File.ReadAllText(ThemeFile).Trim() });
                    break;
                case "theme": File.WriteAllText(ThemeFile, m.GetProperty("name").GetString()); break;
                case "shot":   // foto da tela atual, para o efeito de vidro quebrando da batalha 3D
                    using (var ms = new MemoryStream())
                    {
                        await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Jpeg, ms);
                        Send(new { type = "shot", data = Convert.ToBase64String(ms.ToArray()) });
                    }
                    break;
                case "kids":
                    Send(new
                    {
                        type = "kids",
                        map = m.GetProperty("ids").EnumerateArray().Select(x => x.GetInt32()).Distinct()
                            .Where(i => ids.TryGetValue(i, out var n) && n.IsDir && !n.IsLink)   // ids de itens já excluídos são ignorados
                            .ToDictionary(i => i.ToString(), i => Kids(ids[i])),
                    });
                    break;
                case "scan": await Scan(m.GetProperty("path").GetString()); break;
                case "pick":
                    using (var dlg = new FolderBrowserDialog())
                        if (dlg.ShowDialog(this) == DialogResult.OK) await Scan(dlg.SelectedPath);
                    break;
                case "cancel": Scanner.Cancel = true; break;
                case "explorer": Process.Start("explorer.exe", "/select,\"" + ids[m.GetProperty("id").GetInt32()].FullPath + "\""); break;
                case "copy": Clipboard.SetText(ids[m.GetProperty("id").GetInt32()].FullPath); Send(new { type = "toast", text = "Caminho copiado" }); break;
                case "ask": AskDelete(NodesOf(m), m.GetProperty("permanent").GetBoolean(), m.TryGetProperty("empty", out var ae) && ae.GetBoolean()); break;
                case "delete": await Delete(NodesOf(m), m.GetProperty("permanent").GetBoolean(), m.TryGetProperty("empty", out var de) && de.GetBoolean()); break;
            }
        }
        catch (Exception ex) { Send(new { type = "toast", text = ex.Message, error = true }); }
    }

    void SendDrives() => Send(new
    {
        type = "drives",
        drives = DriveInfo.GetDrives().Where(d => d.IsReady).Select(d => new
        {
            path = d.Name, label = string.IsNullOrEmpty(d.VolumeLabel) ? "Disco local" : d.VolumeLabel,
            total = d.TotalSize, free = d.TotalFreeSpace,
        })
    });

    async Task Scan(string path)
    {
        busy = true;
        try
        {
            ids.Clear(); nextId = 0;
            root = new Node { Name = path, Children = new List<Node>() };
            Scanner.Count = 0; Scanner.Denied = 0; Scanner.Cancel = false;
            var sw = Stopwatch.StartNew();
            var task = Task.Run(() => Scanner.Scan(root, path, 0));
            while (!task.IsCompleted)
            {
                Send(new { type = "progress", path, files = Scanner.Count, secs = sw.Elapsed.TotalSeconds });
                await Task.WhenAny(task, Task.Delay(120));
            }
            await task;
            status = (Scanner.Cancel ? "Parado — resultado parcial · " : "") + Scanner.Count.ToString("N0") + " arquivos lidos em "
                + sw.Elapsed.TotalSeconds.ToString("0.0") + " s"
                + (Scanner.Denied > 0 ? " · " + Scanner.Denied + " pastas sem permissão (rode como administrador para ver tudo)" : "");
        }
        finally { busy = false; }
        SendRoot(false);
    }

    // refresh = true: mesma árvore (após exclusão), a interface mantém as pastas abertas.
    void SendRoot(bool refresh) => Send(new { type = "root", refresh, id = IdOf(root), path = root.Name, size = root.Size, files = root.Files, status });

    const int MaxItems = 500;
    object Kids(Node n)
    {
        var rest = n.Children.Skip(MaxItems).ToList();
        return new
        {
            size = n.Size,
            items = n.Children.Take(MaxItems).Select(c => new { id = IdOf(c), name = c.Name, size = c.Size, files = c.Files, kind = c.IsLink ? "link" : c.IsDir ? "dir" : "file", empty = c.IsDir && c.Children.Count == 0 }),
            moreCount = rest.Count, moreSize = rest.Sum(c => c.Size),
        };
    }

    // empty = "esvaziar": apaga o que está dentro das pastas escolhidas, mas mantém as pastas.
    static List<Node> Targets(List<Node> picked, bool empty) =>
        empty ? picked.Where(n => n.IsDir && !n.IsLink).SelectMany(n => n.Children).ToList() : picked;

    void AskDelete(List<Node> picked, bool permanent, bool empty)
    {
        var nodes = Targets(picked, empty);
        if (nodes.Count == 0) { Send(new { type = "toast", text = "A pasta já está vazia" }); return; }
        foreach (var n in nodes)
        {
            string why = Safety.WhyProtected(n.FullPath);
            if (why != null) { Send(new { type = "blocked", path = n.FullPath, why }); return; }
        }
        Send(new
        {
            type = "confirm", permanent, empty, ids = picked.Select(IdOf), count = nodes.Count, total = nodes.Sum(n => n.Size),
            paths = (empty ? picked : nodes).Take(8).Select(n => n.FullPath), more = Math.Max(0, (empty ? picked.Count : nodes.Count) - 8),
        });
    }

    async Task Delete(List<Node> picked, bool permanent, bool empty)
    {
        var nodes = Targets(picked, empty);
        if (nodes.Count == 0) return;
        // Confere de novo aqui: a interface nunca é a única barreira.
        if (nodes.Any(n => Safety.WhyProtected(n.FullPath) != null)) { AskDelete(picked, permanent, empty); return; }
        busy = true;
        long before = nodes.Sum(n => n.Size), after = 0;
        try
        {
            Send(new { type = "busy", on = true, text = permanent ? "Varrendo de vez…" : "Varrendo para a Lixeira…" });
            var paths = nodes.Select(n => n.FullPath).ToList();
            var owner = Handle;
            await RunSta(() => Native.ShellDelete(owner, paths, permanent));

            // Confere no disco o que realmente sumiu; o que sobrou (cancelado/parcial) é reescaneado.
            var fresh = await Task.Run(() => nodes.Select((n, i) =>
            {
                if (!Native.Exists(paths[i])) return null;
                if (!n.IsDir || n.IsLink) return n;
                var f = new Node { Name = n.Name, Parent = n.Parent, Children = new List<Node>() };
                Scanner.Scan(f, paths[i], 0);
                return f;
            }).ToList());

            for (int i = 0; i < nodes.Count; i++)
            {
                Node old = nodes[i], now = fresh[i], parent = old.Parent;
                after += now?.Size ?? 0;
                if (now == old) continue;
                int idx = parent.Children.IndexOf(old);
                if (now == null) parent.Children.RemoveAt(idx); else parent.Children[idx] = now;
                ids.Remove(old.Id);
                long dSize = (now?.Size ?? 0) - old.Size, dFiles = (now?.Files ?? 0) - old.Files;
                for (var a = parent; a != null; a = a.Parent)
                {
                    a.Size += dSize; a.Files += dFiles;
                    a.Children.Sort((x, y) => y.Size.CompareTo(x.Size));
                }
            }
        }
        finally { busy = false; Send(new { type = "busy", on = false }); }
        SendRoot(true);
        SendDrives();
        Send(new { type = "toast", freed = before - after, text = before - after > 0 ? null : "Nada foi excluído" });
    }

    static Task RunSta(Action a)
    {
        var tcs = new TaskCompletionSource();
        var t = new Thread(() => { try { a(); tcs.SetResult(); } catch (Exception e) { tcs.SetException(e); } });
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        return tcs.Task;
    }

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--selftest") return Safety.SelfTest();
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
        return 0;
    }
}
