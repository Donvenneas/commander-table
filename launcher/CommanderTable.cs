// Commander Table desktop app.
// Runs the same local server as server.ps1 (static files, deck-site proxy, Comprehensive Rules cache,
// exit endpoint) inside this program, opens the game in its own browser window (never Microsoft Edge), and shuts
// everything down when that window closes. A tray icon offers Open and Exit as a fallback.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Commander Table")]
[assembly: System.Reflection.AssemblyProduct("Commander Table")]
[assembly: System.Reflection.AssemblyDescription("Watch AI pilots play Magic: The Gathering Commander")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

static class CommanderTable
{
    const string UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 CommanderTable/1.0";
    static readonly HashSet<string> AllowedHosts = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "archidekt.com", "www.archidekt.com",
        "api2.moxfield.com", "api.moxfield.com", "moxfield.com", "www.moxfield.com",
        "www.mtggoldfish.com", "mtggoldfish.com",
        "tappedout.net", "deckstats.net",
        "magic.wizards.com", "media.wizards.com",
        "cedh-decklist-database.com", "www.cedh-decklist-database.com",
        "cubecobra.com", "www.cubecobra.com",
    };
    static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
        { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" }, { ".json", "application/json" }, { ".svg", "image/svg+xml" },
        { ".png", "image/png" }, { ".ico", "image/x-icon" }, { ".txt", "text/plain; charset=utf-8" },
        { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".webp", "image/webp" },
    };

    static string AppDir, Root, Cache, DataDir, ProfileDir, Url;

    // Portable: the window's saved settings and the internet-play tool live in a "data" folder next to
    // the program, so copying the whole folder to another PC (or a USB stick) brings everything along.
    // If that folder can't be written (a read-only drive), fall back to this user's AppData.
    static string FindDataDir()
    {
        var local = Path.Combine(AppDir, "data");
        try
        {
            Directory.CreateDirectory(local);
            var probe = Path.Combine(local, ".write-test");
            File.WriteAllText(probe, "");
            File.Delete(probe);
            return local;
        }
        catch
        {
            var fallback = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CommanderTable");
            Directory.CreateDirectory(fallback);
            return fallback;
        }
    }

    // WMI's LIKE treats [ ] _ % as wildcards; escape them so any folder name works
    static string LikeEscape(string s) { return s.Replace("[", "[[]").Replace("_", "[_]").Replace("%", "[%]").Replace("\\", "\\\\").Replace("'", "''"); }
    static HttpListener Listener;
    static NotifyIcon Tray;
    static volatile bool Quitting;

    [STAThread]
    static void Main(string[] args)
    {
        // --no-window: run just the server and tray icon (open the game in any browser yourself)
        var noWindow = Array.Exists(args, a => a.Equals("--no-window", StringComparison.OrdinalIgnoreCase));
        AppDir = AppDomain.CurrentDomain.BaseDirectory;
        Root = Path.GetFullPath(Path.Combine(AppDir, "public"));
        Cache = Path.Combine(AppDir, "cache");
        DataDir = FindDataDir();
        // Left behind by an update (the old program renames itself so the new one can be written)
        try { var old = Application.ExecutablePath + ".old"; if (File.Exists(old)) File.Delete(old); } catch { }
        var forced = Array.Find(args, a => a.StartsWith("--browser=", StringComparison.OrdinalIgnoreCase));
        if (forced != null) ForcedBrowser = forced.Substring("--browser=".Length).Trim('"');
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        Application.EnableVisualStyles();

        if (!Directory.Exists(Root))
        {
            MessageBox.Show("The \"public\" folder wasn't found next to Commander Table.exe.\n\nKeep the program in the same folder as the game files. If you opened it from inside a .zip file, extract the whole zip first (right-click it, then Extract All…) and run Commander Table.exe from the extracted folder.", "Commander Table", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        // On a read-only drive the rules cache can't be refreshed, but the copy that came with the folder still works
        try { Directory.CreateDirectory(Cache); } catch { }

        // Only one copy at a time: a second launch just opens another window on the running game
        bool first;
        using (var mutex = new Mutex(true, "CommanderTable.SingleInstance", out first))
        {
            if (!first) { OpenWindow(FindRunningUrl()); return; }

            if (!StartServer())
            {
                MessageBox.Show("Commander Table couldn't start its local server (ports 8777–8790 are all busy).", "Commander Table", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            try { File.WriteAllText(Path.Combine(DataDir, "running-url.txt"), Url); } catch { }
            SetupTray();
            if (!noWindow && OpenWindow(Url)) new Thread(WatchWindow) { IsBackground = true }.Start();
            Application.Run();
            Shutdown();
        }
    }

    // ---------- the game window (never Microsoft Edge)
    // The game opens in your default browser, unless that's Microsoft Edge, in which case another installed
    // browser is used. Chrome-family browsers (Chrome, Brave, Vivaldi, Chromium) open a tab-free app window
    // and Firefox opens its own window, each with a private profile kept in the data folder, separate from
    // your everyday browsing. --browser="C:\path\to\browser.exe" picks one yourself.
    static string ForcedBrowser;
    static readonly string[] Chromium = { "chrome.exe", "brave.exe", "vivaldi.exe", "chromium.exe" };

    static string DefaultBrowser()
    {
        try
        {
            var progId = Microsoft.Win32.Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice", "ProgId", null) as string;
            if (progId == null) return null;
            var cmd = Microsoft.Win32.Registry.GetValue(@"HKEY_CLASSES_ROOT\" + progId + @"\shell\open\command", "", null) as string;
            if (cmd == null) return null;
            var m = Regex.Match(cmd, "^\\s*\"([^\"]+)\"|^\\s*(\\S+)");
            var exe = m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value;
            return File.Exists(exe) ? exe : null;
        }
        catch { return null; }
    }

    static bool IsEdge(string exe) { return Path.GetFileName(exe).Equals("msedge.exe", StringComparison.OrdinalIgnoreCase); }

    static string PickBrowser()
    {
        if (ForcedBrowser != null && File.Exists(ForcedBrowser) && !IsEdge(ForcedBrowser)) return ForcedBrowser;
        var def = DefaultBrowser();
        if (def != null && !IsEdge(def)) return def;
        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (var p in new[] {
            Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"), Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"), Path.Combine(local, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(pf, @"Mozilla Firefox\firefox.exe"), Path.Combine(pf86, @"Mozilla Firefox\firefox.exe"),
            Path.Combine(pf, @"BraveSoftware\Brave-Browser\Application\brave.exe"), Path.Combine(local, @"BraveSoftware\Brave-Browser\Application\brave.exe"),
            Path.Combine(local, @"Vivaldi\Application\vivaldi.exe"), Path.Combine(local, @"Chromium\Application\chrome.exe"),
        })
            if (File.Exists(p)) return p;
        return null;
    }

    // Returns true when the window can be watched (closing it quits the app)
    static bool OpenWindow(string url)
    {
        var browser = PickBrowser();
        if (browser == null)
        {
            try { Clipboard.SetText(url); } catch { }
            MessageBox.Show("Commander Table runs in a web browser, and the only one found is Microsoft Edge, which it doesn't use.\n\nOpen " + url + " in any other browser (the address is on your clipboard), or install a free browser such as Firefox or Chrome and start Commander Table again.\n\nTo quit, use Exit in the game or the tray icon by the clock.", "Commander Table", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return false;
        }
        var name = Path.GetFileName(browser).ToLowerInvariant();
        if (Array.IndexOf(Chromium, name) >= 0)
        {
            ProfileDir = Path.Combine(DataDir, "BrowserProfile");
            Directory.CreateDirectory(ProfileDir);
            var args = string.Format("--app=\"{0}\" --user-data-dir=\"{1}\" --no-first-run --no-default-browser-check --disable-background-mode --window-size=1440,900", url, ProfileDir);
            Process.Start(new ProcessStartInfo(browser, args) { UseShellExecute = false });
            return true;
        }
        if (name == "firefox.exe")
        {
            ProfileDir = Path.Combine(DataDir, "FirefoxProfile");
            Directory.CreateDirectory(ProfileDir);
            // Quiet, private profile: no welcome pages, default-browser nagging or data reporting
            var prefs = Path.Combine(ProfileDir, "user.js");
            if (!File.Exists(prefs)) File.WriteAllText(prefs, string.Join("\n", new[] {
                "user_pref(\"browser.aboutwelcome.enabled\", false);",
                "user_pref(\"trailhead.firstrun.didSeeAboutWelcome\", true);",
                "user_pref(\"browser.startup.homepage_override.mstone\", \"ignore\");",
                "user_pref(\"startup.homepage_welcome_url\", \"\");",
                "user_pref(\"browser.shell.checkDefaultBrowser\", false);",
                "user_pref(\"datareporting.policy.dataSubmissionEnabled\", false);",
                "user_pref(\"datareporting.healthreport.uploadEnabled\", false);",
                "user_pref(\"toolkit.telemetry.enabled\", false);",
                "user_pref(\"toolkit.telemetry.reportingpolicy.firstRun\", false);",
                "user_pref(\"browser.newtabpage.activity-stream.feeds.telemetry\", false);",
                "user_pref(\"browser.tabs.warnOnClose\", false);",
            }) + "\n");
            Process.Start(new ProcessStartInfo(browser, string.Format("-profile \"{0}\" -no-remote -new-instance \"{1}\"", ProfileDir, url)) { UseShellExecute = false });
            return true;
        }
        // Any other browser: open the game in it normally (quit with Exit or the tray icon)
        Process.Start(new ProcessStartInfo(browser, "\"" + url + "\"") { UseShellExecute = false });
        return false;
    }

    // Browser processes running on our private profile
    static string WindowQuery() { return "SELECT ProcessId FROM Win32_Process WHERE CommandLine LIKE '%" + LikeEscape(ProfileDir) + "%'"; }

    static int WindowsOpen()
    {
        try { using (var q = new ManagementObjectSearcher(WindowQuery())) return q.Get().Count; }
        catch { return 1; } // if we can't tell, assume it's still open (the tray icon can always exit)
    }

    // When the game window (every browser process using our profile) is gone, quit
    static void WatchWindow()
    {
        Thread.Sleep(8000); // give the browser time to start
        int gone = 0;
        while (!Quitting)
        {
            gone = WindowsOpen() == 0 ? gone + 1 : 0;
            if (gone >= 2) { Quit(); return; }
            Thread.Sleep(1500);
        }
    }

    static void CloseWindow()
    {
        if (ProfileDir == null) return;
        try
        {
            using (var q = new ManagementObjectSearcher(WindowQuery()))
                foreach (ManagementObject m in q.Get())
                    try { Process.GetProcessById(Convert.ToInt32(m["ProcessId"])).Kill(); } catch { }
        }
        catch { }
    }

    static string FindRunningUrl()
    {
        try { return File.ReadAllText(Path.Combine(DataDir, "running-url.txt")).Trim(); } catch { return "http://localhost:8777/"; }
    }

    // ---------- tray icon
    static void SetupTray()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Commander Table", null, (s, e) => OpenWindow(Url));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (s, e) => Quit());
        Tray = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application,
            Text = "Commander Table",
            ContextMenuStrip = menu,
            Visible = true,
        };
        Tray.DoubleClick += (s, e) => OpenWindow(Url);
    }

    static void Quit()
    {
        if (Quitting) return;
        Quitting = true;
        Application.Exit();
    }

    static void Shutdown()
    {
        Quitting = true;
        if (Tray != null) { Tray.Visible = false; Tray.Dispose(); }
        CloseWindow();
        try { Listener.Stop(); Listener.Close(); } catch { }
        try { if (Lan != null) Lan.Stop(); } catch { }
        try { if (Tunnel != null && !Tunnel.HasExited) Tunnel.Kill(); } catch { }
        try { File.Delete(Path.Combine(DataDir, "running-url.txt")); } catch { }
    }

    // ---------- local server (same endpoints as server.ps1)
    static bool StartServer()
    {
        for (int port = 8777; port <= 8790; port++)
        {
            var l = new HttpListener();
            l.Prefixes.Add("http://localhost:" + port + "/");
            try { l.Start(); } catch { l.Close(); continue; }
            Listener = l;
            Url = "http://localhost:" + port + "/";
            new Thread(ServeLoop) { IsBackground = true }.Start();
            return true;
        }
        return false;
    }

    static void ServeLoop()
    {
        while (!Quitting && Listener.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = Listener.GetContext(); } catch { return; }
            ThreadPool.QueueUserWorkItem(_ => Handle(ctx));
        }
    }

    static void Handle(HttpListenerContext ctx)
    {
        var req = ctx.Request;
        var path = Uri.UnescapeDataString(req.Url.AbsolutePath);
        try
        {
            // Other websites' pages can send simple requests to localhost; only the game's own page may use /api/
            // (the browser marks cross-site requests with Origin and Sec-Fetch-Site; HttpListener already
            // refuses Host headers other than localhost, which stops DNS rebinding)
            if (path.StartsWith("/api/") && Foreign(req)) { SendText(ctx, 403, "Only the Commander Table page on this computer can use this."); return; }
            if (path.StartsWith("/api/room/"))
            {
                var r = Room(req.HttpMethod, path, req.QueryString["seat"], req.QueryString["code"], ReadBody(req.InputStream, req.ContentLength64), true);
                Send(ctx, r.Status, r.Type, Encoding.UTF8.GetBytes(r.Body));
            }
            else if (path == "/api/fetch") Proxy(ctx);
            else if (path == "/api/img") CardImage(ctx);
            else if (path == "/api/library") Library(ctx);
            else if (path == "/api/update") Update(ctx);
            else if (path == "/api/edhtop16" && req.HttpMethod == "POST")
            {
                // EDHTop16's public GraphQL API only answers its own registered queries; we pass them through
                int status; string type;
                var body = PostRemote("https://edhtop16.com/api/graphql", ReadBody(req.InputStream, req.ContentLength64), out status, out type);
                Send(ctx, status, type, body);
            }
            else if (path == "/api/rules")
            {
                string source;
                var body = GetRules(out source);
                Send(ctx, 200, "text/plain", body, "X-Rules-Source", source ?? "");
            }
            else if (path == "/api/exit")
            {
                // The custom header forces a CORS preflight, so other websites can't shut the app down
                if (req.HttpMethod != "POST" || req.Headers["X-Commander-Table"] != "exit") SendText(ctx, 400, "Use the Exit button in the app.");
                else
                {
                    SendText(ctx, 200, "Commander Table has shut down.");
                    // Let the page show its goodbye message, then close the window and quit
                    new Thread(() => { Thread.Sleep(1200); Quit(); }) { IsBackground = true }.Start();
                }
            }
            else ServeFile(ctx, path);
        }
        catch (Exception e)
        {
            try { SendText(ctx, 502, e.Message); } catch { }
        }
    }

    static bool Foreign(HttpListenerRequest req)
    {
        var port = req.Url.Port;
        var origin = (req.Headers["Origin"] ?? "").ToLowerInvariant();
        if (origin != "" && origin != "http://localhost:" + port && origin != "http://127.0.0.1:" + port) return true;
        var site = (req.Headers["Sec-Fetch-Site"] ?? "").ToLowerInvariant();
        return site == "cross-site" || site == "same-site";
    }

    static void ServeFile(HttpListenerContext ctx, string path)
    {
        if (path == "/") path = "/index.html";
        var full = Path.GetFullPath(Path.Combine(Root, path.TrimStart('/').Replace('/', '\\')));
        if (!full.StartsWith(Root, StringComparison.OrdinalIgnoreCase) || !File.Exists(full)) { SendText(ctx, 404, "Not found"); return; }
        string type;
        if (!Mime.TryGetValue(Path.GetExtension(full), out type)) type = "application/octet-stream";
        Send(ctx, 200, type, File.ReadAllBytes(full));
    }

    static void Proxy(HttpListenerContext ctx)
    {
        Uri u;
        var target = ctx.Request.QueryString["url"];
        if (!Uri.TryCreate(target, UriKind.Absolute, out u) || u.Scheme != "https" || !AllowedHosts.Contains(u.Host))
        {
            SendText(ctx, 400, "That URL is not on the allowed deck-site list.");
            return;
        }
        int status; string type;
        var body = GetRemote(u.AbsoluteUri, out status, out type);
        Send(ctx, status, type, body, "X-Upstream-Status", status.ToString());
    }

    // Deck library: plain-text decklists in data\decks, one file per deck, so they travel with the folder.
    // GET lists them (name, modified, text); POST ?name= saves the body; DELETE ?name= removes one.
    static readonly object LibraryLock = new object();
    static void Library(HttpListenerContext ctx)
    {
        var dir = Path.Combine(DataDir, "decks");
        var req = ctx.Request;
        var name = (req.QueryString["name"] ?? "").Trim();
        // File names: letters, digits, spaces and a few safe marks only
        var safe = Regex.Replace(name, "[^\\w ,.'&+()-]", "").Trim().TrimStart('.');
        if (safe.Length > 80) safe = safe.Substring(0, 80);
        lock (LibraryLock)
        {
            if (req.HttpMethod == "GET")
            {
                var parts = new List<string>();
                if (Directory.Exists(dir))
                    foreach (var f in new DirectoryInfo(dir).GetFiles("*.txt"))
                        parts.Add("{\"name\":" + Js(Path.GetFileNameWithoutExtension(f.Name)) + ",\"modified\":" + Js(f.LastWriteTimeUtc.ToString("o")) + ",\"text\":" + Js(File.ReadAllText(f.FullName).Replace("\t", " ")) + "}");
                Send(ctx, 200, "application/json", Encoding.UTF8.GetBytes("[" + string.Join(",", parts) + "]"));
                return;
            }
            // The custom header forces a CORS preflight, so other websites can't change the library
            if (req.Headers["X-Commander-Table"] != "library") { SendText(ctx, 400, "Use the deck library in the app."); return; }
            if (safe.Length == 0) { SendText(ctx, 400, "The deck needs a name."); return; }
            var file = Path.Combine(dir, safe + ".txt");
            if (req.HttpMethod == "POST")
            {
                var body = ReadBody(req.InputStream, req.ContentLength64);
                if (body.Length > 200000) { SendText(ctx, 400, "That decklist is too long."); return; }
                Directory.CreateDirectory(dir);
                File.WriteAllText(file, body, new UTF8Encoding(false));
                Send(ctx, 200, "application/json", Encoding.UTF8.GetBytes("{\"name\":" + Js(safe) + "}"));
                return;
            }
            if (req.HttpMethod == "DELETE")
            {
                if (File.Exists(file)) File.Delete(file);
                Send(ctx, 200, "application/json", Encoding.UTF8.GetBytes("{}"));
                return;
            }
        }
        SendText(ctx, 405, "Use GET, POST or DELETE.");
    }

    // ---------- updates, only when asked: download a zip of a newer version from an address the user
    // chose (a GitHub release, for example), then copy its files over this folder. data\ is never touched,
    // every replaced file is first backed up to data\update\backup-<time>, and the running program is
    // renamed to "Commander Table.exe.old" so the new one can take its place after a restart.
    static readonly object UpdateLock = new object();
    static string LocalVersion() { var f = Path.Combine(AppDir, "VERSION"); return File.Exists(f) ? File.ReadAllText(f).Trim() : "unknown"; }
    static void Update(HttpListenerContext ctx)
    {
        var req = ctx.Request;
        var dir = Path.Combine(DataDir, "update");
        var urlFile = Path.Combine(dir, "source-url.txt");
        var zipFile = Path.Combine(dir, "download.zip");
        if (req.HttpMethod == "GET")
        {
            var saved = File.Exists(urlFile) ? File.ReadAllText(urlFile).Trim() : "";
            Send(ctx, 200, "application/json", Encoding.UTF8.GetBytes("{\"version\":" + Js(LocalVersion()) + ",\"url\":" + Js(saved) + "}"));
            return;
        }
        if (req.HttpMethod != "POST" || req.Headers["X-Commander-Table"] != "update") { SendText(ctx, 400, "Use the Updates window in the app."); return; }
        lock (UpdateLock)
        {
            var step = req.QueryString["step"];
            if (step == "check")
            {
                Uri u;
                var url = ReadBody(req.InputStream, req.ContentLength64).Trim();
                if (!Uri.TryCreate(url, UriKind.Absolute, out u) || u.Scheme != "https") { SendText(ctx, 400, "The update address must start with https://"); return; }
                Directory.CreateDirectory(dir);
                File.WriteAllText(urlFile, u.AbsoluteUri);
                int status; string type;
                var body = GetRemote(u.AbsoluteUri, out status, out type);
                if (status != 200) { SendText(ctx, 502, "The update address answered HTTP " + status + "."); return; }
                if (body.Length < 4 || body[0] != 'P' || body[1] != 'K') { SendText(ctx, 400, "That address didn't give a .zip file."); return; }
                File.WriteAllBytes(zipFile, body);
                string prefix, version; int count;
                var err = InspectUpdate(zipFile, out prefix, out version, out count);
                if (err != null) { File.Delete(zipFile); SendText(ctx, 400, err); return; }
                Send(ctx, 200, "application/json", Encoding.UTF8.GetBytes("{\"version\":" + Js(version) + ",\"current\":" + Js(LocalVersion()) + ",\"files\":" + count + ",\"size\":" + body.Length + "}"));
                return;
            }
            if (step == "apply")
            {
                if (!File.Exists(zipFile)) { SendText(ctx, 400, "Check for an update first."); return; }
                string prefix, version; int count;
                var err = InspectUpdate(zipFile, out prefix, out version, out count);
                if (err != null) { SendText(ctx, 400, err); return; }
                var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
                var backup = Path.Combine(dir, "backup-" + stamp);
                int changed = 0;
                var root = Path.GetFullPath(AppDir);
                using (var zip = System.IO.Compression.ZipFile.OpenRead(zipFile))
                {
                    foreach (var e in zip.Entries)
                    {
                        var rel = e.FullName.Replace('\\', '/');
                        if (!rel.StartsWith(prefix) || rel.EndsWith("/")) continue;
                        rel = rel.Substring(prefix.Length);
                        if (rel.Length == 0 || rel.StartsWith("data/", StringComparison.OrdinalIgnoreCase)) continue;
                        var target = Path.GetFullPath(Path.Combine(root, rel.Replace('/', '\\')));
                        if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                        byte[] bytes;
                        using (var s = e.Open()) using (var ms = new MemoryStream()) { s.CopyTo(ms); bytes = ms.ToArray(); }
                        if (File.Exists(target))
                        {
                            var old = File.ReadAllBytes(target);
                            if (old.Length == bytes.Length && System.Linq.Enumerable.SequenceEqual(old, bytes)) continue;
                            var b = Path.Combine(backup, rel.Replace('/', '\\'));
                            Directory.CreateDirectory(Path.GetDirectoryName(b));
                            File.WriteAllBytes(b, old);
                            // A running program can't be overwritten, but it can be renamed out of the way
                            if (target.Equals(Application.ExecutablePath, StringComparison.OrdinalIgnoreCase))
                            {
                                var moved = target + ".old";
                                if (File.Exists(moved)) File.Delete(moved);
                                File.Move(target, moved);
                            }
                        }
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        File.WriteAllBytes(target, bytes);
                        changed++;
                    }
                }
                File.Delete(zipFile);
                Send(ctx, 200, "application/json", Encoding.UTF8.GetBytes("{\"changed\":" + changed + ",\"version\":" + Js(LocalVersion()) + ",\"backup\":" + Js(changed > 0 ? "data\\update\\backup-" + stamp : "") + "}"));
                return;
            }
        }
        SendText(ctx, 400, "Unknown step.");
    }
    // A usable update zip has the game's files (public/index.html at least), possibly inside one top folder
    static string InspectUpdate(string zipFile, out string prefix, out string version, out int count)
    {
        prefix = null; version = "unknown"; count = 0;
        try
        {
            using (var zip = System.IO.Compression.ZipFile.OpenRead(zipFile))
            {
                foreach (var e in zip.Entries)
                {
                    var n = e.FullName.Replace('\\', '/');
                    if (n.EndsWith("public/index.html") && (prefix == null || n.Length < prefix.Length + 17)) prefix = n.Substring(0, n.Length - "public/index.html".Length);
                }
                if (prefix == null || prefix.Split('/').Length > 2) return "That zip doesn't look like Commander Table (no public/index.html in it).";
                foreach (var e in zip.Entries)
                {
                    var n = e.FullName.Replace('\\', '/');
                    if (!n.StartsWith(prefix) || n.EndsWith("/")) continue;
                    if (n.Contains("../") || n.Contains(":")) return "That zip contains unsafe file paths, so it wasn't used.";
                    if (n.Substring(prefix.Length).StartsWith("data/", StringComparison.OrdinalIgnoreCase)) continue;
                    count++;
                    if (n == prefix + "VERSION") using (var r = new StreamReader(e.Open())) version = r.ReadToEnd().Trim();
                }
            }
            return null;
        }
        catch (Exception ex) { return "That zip couldn't be read: " + ex.Message; }
    }

    // Card images from Scryfall's image servers, kept in data\images after the first download so the
    // table has its art offline (and the folder carries them to another PC). Oldest are dropped past 400 MB.
    const long ImageCacheMax = 400L * 1024 * 1024;
    static int ImagesSaved;
    static void CardImage(HttpListenerContext ctx)
    {
        Uri u;
        var target = ctx.Request.QueryString["u"];
        if (!Uri.TryCreate(target, UriKind.Absolute, out u) || u.Scheme != "https" || (u.Host != "cards.scryfall.io" && u.Host != "svgs.scryfall.io"))
        {
            SendText(ctx, 400, "Only Scryfall card images are served here.");
            return;
        }
        var ext = Path.GetExtension(u.AbsolutePath).ToLowerInvariant();
        string type;
        if (!Mime.TryGetValue(ext, out type) || !type.StartsWith("image/")) { ext = ".jpg"; type = "image/jpeg"; }
        string name;
        using (var sha = System.Security.Cryptography.SHA1.Create())
            name = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(u.AbsoluteUri))).Replace("-", "").ToLowerInvariant();
        var dir = Path.Combine(DataDir, "images");
        var file = Path.Combine(dir, name + ext);
        const string keep = "public, max-age=2592000";
        if (File.Exists(file)) { Send(ctx, 200, type, File.ReadAllBytes(file), "Cache-Control", keep); return; }
        int status; string remoteType;
        var body = GetRemote(u.AbsoluteUri, out status, out remoteType);
        if (status == 200 && body.Length > 0)
        {
            try
            {
                Directory.CreateDirectory(dir);
                File.WriteAllBytes(file, body);
                if (Interlocked.Increment(ref ImagesSaved) % 200 == 0) new Thread(TrimImages) { IsBackground = true }.Start();
            }
            catch { /* read-only drive: still show the image */ }
            Send(ctx, 200, remoteType.StartsWith("image/") ? remoteType : type, body, "Cache-Control", keep);
        }
        else Send(ctx, status, remoteType, body);
    }
    static void TrimImages()
    {
        try
        {
            var files = new DirectoryInfo(Path.Combine(DataDir, "images")).GetFiles();
            long total = 0;
            foreach (var f in files) total += f.Length;
            if (total <= ImageCacheMax) return;
            Array.Sort(files, (a, b) => a.LastWriteTimeUtc.CompareTo(b.LastWriteTimeUtc));
            foreach (var f in files) { if (total <= ImageCacheMax * 0.8) break; total -= f.Length; try { f.Delete(); } catch { } }
        }
        catch { }
    }

    static byte[] GetRemote(string url, out int status, out string type)
    {
        var req = (HttpWebRequest)WebRequest.Create(url);
        req.UserAgent = UA;
        req.Accept = "application/json, text/plain, text/html;q=0.9, */*;q=0.8";
        req.Headers.Add("Accept-Language", "en-US,en;q=0.9");
        req.Timeout = 30000;
        req.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
        HttpWebResponse resp;
        try { resp = (HttpWebResponse)req.GetResponse(); }
        catch (WebException we)
        {
            resp = we.Response as HttpWebResponse;
            if (resp == null) throw;
        }
        using (resp)
        using (var ms = new MemoryStream())
        {
            resp.GetResponseStream().CopyTo(ms);
            status = (int)resp.StatusCode;
            type = string.IsNullOrEmpty(resp.ContentType) ? "application/octet-stream" : resp.ContentType;
            return ms.ToArray();
        }
    }

    static byte[] PostRemote(string url, string json, out int status, out string type)
    {
        var req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = "POST";
        req.UserAgent = UA;
        req.ContentType = "application/json";
        req.Accept = "application/json";
        req.Timeout = 30000;
        req.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
        var bytes = Encoding.UTF8.GetBytes(json);
        using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
        HttpWebResponse resp;
        try { resp = (HttpWebResponse)req.GetResponse(); }
        catch (WebException we) { resp = we.Response as HttpWebResponse; if (resp == null) throw; }
        using (resp)
        using (var ms = new MemoryStream())
        {
            resp.GetResponseStream().CopyTo(ms);
            status = (int)resp.StatusCode;
            type = string.IsNullOrEmpty(resp.ContentType) ? "application/json" : resp.ContentType;
            return ms.ToArray();
        }
    }

    // The Comprehensive Rules, downloaded from Wizards and cached for a week
    static readonly object RulesLock = new object();
    static byte[] GetRules(out string source)
    {
        lock (RulesLock)
        {
            var file = Path.Combine(Cache, "MagicCompRules.txt");
            var srcFile = Path.Combine(Cache, "rules-source.txt");
            source = File.Exists(srcFile) ? File.ReadAllText(srcFile).Trim() : null;
            if (File.Exists(file) && (DateTime.Now - File.GetLastWriteTime(file)).TotalDays < 7) return File.ReadAllBytes(file);
            try
            {
                int status; string type;
                var html = Encoding.UTF8.GetString(GetRemote("https://magic.wizards.com/en/rules", out status, out type));
                var m = Regex.Match(html, "https://media\\.wizards\\.com/[^\"'<>]+?\\.txt");
                if (!m.Success) throw new Exception("Could not find the Comprehensive Rules .txt link on magic.wizards.com/en/rules");
                var txtUrl = m.Value.Replace(" ", "%20");
                var body = GetRemote(txtUrl, out status, out type);
                if (status != 200) throw new Exception("Rules download failed with HTTP " + status);
                File.WriteAllBytes(file, body);
                File.WriteAllText(srcFile, txtUrl);
                source = txtUrl;
                return body;
            }
            catch
            {
                if (File.Exists(file)) return File.ReadAllBytes(file);
                throw;
            }
        }
    }

    // ---------- online seats
    // The game runs in the host's window. For each seat a friend plays, the host posts that seat's view of
    // the board and any question waiting for them; the friend's page polls for it and posts an answer.
    // Host-only calls are accepted only from this PC; friends need the room code.
    class Seat { public string State = "null", Question = "null", Answer = null, Name = "", UndoReply = null, Deck = null, Key = SeatKey(); public DateTime Seen = DateTime.MinValue, LastChat = DateTime.MinValue, UndoAsk = DateTime.MinValue; }
    // Each seat (and the spectators' view) has its own secret join code, so a friend can't open another
    // seat's view (and see that hand) by changing the seat number in their link. 10 characters from 32
    // letters and digits (no 0/O, 1/I) is about 50 bits; wrong codes are also limited to 30 a minute.
    const string KeyChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    static readonly System.Security.Cryptography.RandomNumberGenerator Rng = System.Security.Cryptography.RandomNumberGenerator.Create();
    static string SeatKey()
    {
        var b = new byte[10];
        lock (Rng) Rng.GetBytes(b);
        var sb = new StringBuilder();
        foreach (var x in b) sb.Append(KeyChars[x % 32]);
        return sb.ToString();
    }
    static List<DateTime> Fails = new List<DateTime>();
    static bool SameKey(string a, string b)
    {
        if (a == null || b == null || a.Length != b.Length) return false;
        int d = 0;
        for (int i = 0; i < a.Length; i++) d |= a[i] ^ b[i];
        return d == 0;
    }
    static List<string> Chat = new List<string>();
    static int ChatId;
    class Reply { public int Status = 200; public string Type = "application/json"; public string Body = "{}"; }
    static readonly object RoomLock = new object();
    static string RoomCode;
    static Dictionary<int, Seat> Seats = new Dictionary<int, Seat>();
    static TcpListener Lan;
    static int LanPort;

    static string ReadBody(Stream s, long len)
    {
        if (len <= 0) return "";
        using (var r = new StreamReader(s, Encoding.UTF8)) return r.ReadToEnd();
    }

    static string Js(string s) { return "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "") + "\""; }

    static Reply Room(string method, string path, string seatStr, string code, string body, bool local)
    {
        var r = new Reply();
        int seat;
        int.TryParse(seatStr, out seat);
        var action = path.Substring("/api/room/".Length);
        lock (RoomLock)
        {
            // Friend calls: need the room code (seat -1 is the spectators' view)
            if (action == "view" || action == "answer" && method == "POST" || action == "hello" || action == "chat" && method == "POST" || action == "undo" && method == "POST" || action == "deck" && method == "POST")
            {
                Seat s;
                if (RoomCode == null || !Seats.TryGetValue(seat, out s) || !SameKey((code ?? "").ToUpperInvariant(), s.Key))
                {
                    Fails.RemoveAll(t => (DateTime.Now - t).TotalSeconds >= 60);
                    Fails.Add(DateTime.Now);
                    if (Fails.Count > 30) { r.Status = 429; r.Body = "{\"error\":\"Too many wrong join codes. Wait a minute and try again.\"}"; return r; }
                    r.Status = 403; r.Body = "{\"error\":\"This game isn't open, or the link is out of date.\"}"; return r; }
                if (seat >= 0) s.Seen = DateTime.Now;
                if (action == "view")
                {
                    r.Body = "{\"state\":" + s.State + ",\"question\":" + s.Question + ",\"undoReply\":" + (s.UndoReply == null ? "null" : Js(s.UndoReply)) + "}";
                    s.UndoReply = null;
                }
                else if (action == "undo") { if (seat >= 0) { s.UndoAsk = DateTime.Now; s.UndoReply = null; } }
                // Lobby: the friend's own deck (a pasted list, or "library:Name" from the host's library)
                else if (action == "deck") { if (seat >= 0 && body.Length <= 200000) s.Deck = body; }
                else if (action == "hello") { if (seat >= 0) s.Name = body.Length > 40 ? body.Substring(0, 40) : body; }
                else if (action == "chat")
                {
                    // "name\ntext", at most one message a second per seat
                    if ((DateTime.Now - s.LastChat).TotalSeconds < 1) { r.Status = 429; r.Body = "{\"error\":\"Slow down\"}"; return r; }
                    s.LastChat = DateTime.Now;
                    var nl = body.IndexOf('\n');
                    var who = Regex.Replace(nl > 0 ? body.Substring(0, Math.Min(nl, 24)) : "", "[\\x00-\\x1f]", " ");
                    var text = Regex.Replace(nl >= 0 ? body.Substring(nl + 1) : body, "[\\x00-\\x1f]", " ").Trim();
                    if (text.Length > 200) text = text.Substring(0, 200);
                    if (text.Length > 0)
                    {
                        Chat.Add("{\"id\":" + (++ChatId) + ",\"seat\":" + seat + ",\"name\":" + Js(who) + ",\"text\":" + Js(text) + "}");
                        if (Chat.Count > 50) Chat.RemoveAt(0);
                    }
                }
                else s.Answer = body;
                return r;
            }
            if (!local) { r.Status = 403; r.Body = "{\"error\":\"Only the host can do that.\"}"; return r; }
            // Host calls
            switch (action)
            {
                case "open":
                {
                    if (!StartLan()) { r.Status = 500; r.Body = "{\"error\":\"Couldn't open a port for other players (8800–8820 are busy).\"}"; return r; }
                    RoomCode = Guid.NewGuid().ToString("N").Substring(0, 6).ToUpper();
                    Seats = new Dictionary<int, Seat>();
                    Chat.Clear();
                    Fails.Clear();
                    // ("seat" or "seat=KEY": a resumed game reopens its room with the same keys, so friends' links still work)
                    foreach (var part in body.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
                    {
                        var bits = part.Trim().Split('='); int i;
                        if (!int.TryParse(bits[0], out i)) continue;
                        var ns = new Seat();
                        if (bits.Length > 1 && Regex.IsMatch(bits[1], "^[" + KeyChars + "]{10}$")) ns.Key = bits[1];
                        Seats[i] = ns;
                    }
                    var keys = new List<string>();
                    foreach (var kv in Seats) keys.Add(Js(kv.Key.ToString()) + ":" + Js(kv.Value.Key));
                    var ips = new List<string>();
                    foreach (var a in Dns.GetHostAddresses(Dns.GetHostName()))
                        // (169.254.x.x addresses are self-assigned and never reachable from other devices)
                        if (a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a) && !a.ToString().StartsWith("169.254.")) ips.Add(Js(a.ToString()));
                    r.Body = "{\"code\":" + Js(RoomCode) + ",\"keys\":{" + string.Join(",", keys) + "},\"port\":" + LanPort + ",\"ips\":[" + string.Join(",", ips) + "]}";
                    return r;
                }
                case "close": RoomCode = null; Seats.Clear(); Chat.Clear(); return r;
                // Chat messages from friends newer than ?seat=<last id seen> (the host polls this)
                case "chat":
                {
                    var newer = new List<string>();
                    foreach (var c in Chat) { var m = Regex.Match(c, "^\\{\"id\":(\\d+)"); if (m.Success && int.Parse(m.Groups[1].Value) > seat) newer.Add(c); }
                    r.Body = "[" + string.Join(",", newer) + "]";
                    return r;
                }
                case "tunnel":
                {
                    if (method == "POST") StartTunnel();
                    r.Body = "{\"status\":" + Js(TunnelStatus) + ",\"url\":" + Js(TunnelUrl) + ",\"error\":" + Js(TunnelError) + "}";
                    return r;
                }
                case "state": { Seat s; if (Seats.TryGetValue(seat, out s)) s.State = body; return r; }
                case "deck": { Seat s; if (Seats.TryGetValue(seat, out s) && s.Deck != null) { r.Type = "text/plain; charset=utf-8"; r.Body = s.Deck; s.Deck = null; } else r.Body = ""; return r; }
                case "undoack": { Seat s; if (Seats.TryGetValue(seat, out s)) { s.UndoAsk = DateTime.MinValue; s.UndoReply = body == "yes" ? "allowed" : "declined"; } return r; }
                case "ask": { Seat s; if (Seats.TryGetValue(seat, out s)) { s.Question = body; s.Answer = null; } return r; }
                case "answer":
                {
                    Seat s;
                    if (!Seats.TryGetValue(seat, out s) || s.Answer == null) { r.Body = "null"; return r; }
                    r.Body = s.Answer;
                    s.Answer = null;
                    return r;
                }
                case "status":
                {
                    var parts = new List<string>();
                    foreach (var kv in Seats)
                        if (kv.Key >= 0) parts.Add("\"" + kv.Key + "\":{\"name\":" + Js(kv.Value.Name) + ",\"seen\":" + (kv.Value.Seen == DateTime.MinValue ? "-1" : ((int)(DateTime.Now - kv.Value.Seen).TotalSeconds).ToString())
                            + ",\"undo\":" + (kv.Value.UndoAsk == DateTime.MinValue ? "-1" : ((int)(DateTime.Now - kv.Value.UndoAsk).TotalSeconds).ToString())
                            + ",\"deck\":" + (kv.Value.Deck != null ? "true" : "false") + "}");
                    r.Body = "{" + string.Join(",", parts) + "}";
                    return r;
                }
            }
        }
        r.Status = 404; r.Body = "{\"error\":\"unknown\"}";
        return r;
    }

    // ---------- internet play: a free Cloudflare quick tunnel (no account, no payment)
    // It gives the friends-only server above a public https address like https://word-word.trycloudflare.com.
    // cloudflared.exe is Cloudflare's official tool; it's downloaded once from Cloudflare's GitHub releases,
    // its digital signature is checked, and it only runs while Commander Table does.
    static string TunnelStatus = "off", TunnelUrl = "", TunnelError = "";
    static Process Tunnel;
    const string CloudflaredUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

    static void StartTunnel()
    {
        if (TunnelStatus == "starting" || TunnelStatus == "downloading" || (TunnelStatus == "on" && Tunnel != null && !Tunnel.HasExited)) return;
        if (Lan == null) { TunnelStatus = "error"; TunnelError = "Open a game with an online seat first."; return; }
        TunnelError = ""; TunnelUrl = "";
        new Thread(() =>
        {
            try
            {
                var exe = Path.Combine(DataDir, "cloudflared.exe");
                // Reuse a copy downloaded before the app became portable instead of downloading it again
                var old = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CommanderTable", "cloudflared.exe");
                if (!File.Exists(exe) && File.Exists(old) && !string.Equals(Path.GetFullPath(old), Path.GetFullPath(exe), StringComparison.OrdinalIgnoreCase)) File.Copy(old, exe);
                if (!File.Exists(exe))
                {
                    TunnelStatus = "downloading";
                    var tmp = exe + ".download";
                    var req = (HttpWebRequest)WebRequest.Create(CloudflaredUrl);
                    req.UserAgent = UA; req.Timeout = 300000; req.AllowAutoRedirect = true;
                    using (var resp = req.GetResponse())
                    using (var src = resp.GetResponseStream())
                    using (var dst = File.Create(tmp)) src.CopyTo(dst);
                    // Only run it if Cloudflare signed it
                    var signer = System.Security.Cryptography.X509Certificates.X509Certificate.CreateFromSignedFile(tmp);
                    if (signer.Subject.IndexOf("Cloudflare", StringComparison.OrdinalIgnoreCase) < 0) { File.Delete(tmp); throw new Exception("The downloaded tunnel tool isn't signed by Cloudflare, so it wasn't used."); }
                    File.Move(tmp, exe);
                }
                TunnelStatus = "starting";
                var psi = new ProcessStartInfo(exe, "tunnel --no-autoupdate --url http://localhost:" + LanPort)
                {
                    UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true,
                };
                Tunnel = Process.Start(psi);
                KillWithUs(Tunnel);
                var found = new Regex("https://[a-z0-9-]+\\.trycloudflare\\.com");
                DataReceivedEventHandler watch = (s, e) =>
                {
                    if (e.Data == null || TunnelStatus == "on") return;
                    var m = found.Match(e.Data);
                    if (m.Success) { TunnelUrl = m.Value; TunnelStatus = "on"; }
                };
                Tunnel.ErrorDataReceived += watch;
                Tunnel.OutputDataReceived += watch;
                Tunnel.BeginErrorReadLine();
                Tunnel.BeginOutputReadLine();
                Tunnel.EnableRaisingEvents = true;
                Tunnel.Exited += (s, e) => { if (!Quitting) { TunnelStatus = "error"; TunnelError = "The internet tunnel stopped. Try again."; } };
                for (int i = 0; i < 60 && TunnelStatus == "starting"; i++) Thread.Sleep(500);
                if (TunnelStatus == "starting") { TunnelStatus = "error"; TunnelError = "Cloudflare didn't hand out an address in time. Check your internet connection and try again."; try { Tunnel.Kill(); } catch { } }
            }
            catch (Exception e) { TunnelStatus = "error"; TunnelError = e.Message; }
        }) { IsBackground = true }.Start();
    }

    // A Windows job object that ends the tunnel tool whenever Commander Table ends, even if it crashes
    // or is force-closed (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)
    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attrs, string name);
    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    static IntPtr Job = IntPtr.Zero;
    static void KillWithUs(Process p)
    {
        try
        {
            if (Job == IntPtr.Zero)
            {
                Job = CreateJobObject(IntPtr.Zero, null);
                // JOBOBJECT_EXTENDED_LIMIT_INFORMATION is 144 bytes on 64-bit (112 on 32-bit); LimitFlags sits at offset 16
                int size = IntPtr.Size == 8 ? 144 : 112;
                var info = System.Runtime.InteropServices.Marshal.AllocHGlobal(size);
                for (int i = 0; i < size; i++) System.Runtime.InteropServices.Marshal.WriteByte(info, i, 0);
                System.Runtime.InteropServices.Marshal.WriteInt32(info, 16, 0x2000);
                SetInformationJobObject(Job, 9, info, (uint)size);
                System.Runtime.InteropServices.Marshal.FreeHGlobal(info);
            }
            AssignProcessToJobObject(Job, p.Handle);
        }
        catch { }
    }

    // A small HTTP server on the local network, started only when you host. It serves the game files and
    // the friend calls above, nothing else (no deck proxy, no exit). Windows may ask to allow it through
    // the firewall the first time.
    static bool StartLan()
    {
        if (Lan != null) return true;
        for (int port = 8800; port <= 8820; port++)
        {
            try
            {
                var l = new TcpListener(IPAddress.Any, port);
                l.Start();
                Lan = l; LanPort = port;
                new Thread(() => { while (!Quitting) { try { var c = Lan.AcceptTcpClient(); ThreadPool.QueueUserWorkItem(_ => LanClient(c)); } catch { return; } } }) { IsBackground = true }.Start();
                return true;
            }
            catch { }
        }
        return false;
    }

    static void LanClient(TcpClient client)
    {
        using (client)
        {
            try
            {
                client.ReceiveTimeout = 10000; client.SendTimeout = 10000;
                var stream = client.GetStream();
                // Read the request head, then the body by Content-Length
                var head = new List<byte>();
                while (head.Count < 16384)
                {
                    int x = stream.ReadByte();
                    if (x == -1) break;
                    head.Add((byte)x);
                    int n = head.Count;
                    if (n >= 4 && head[n - 4] == '\r' && head[n - 3] == '\n' && head[n - 2] == '\r' && head[n - 1] == '\n') break;
                }
                var lines = Encoding.ASCII.GetString(head.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None);
                var first = lines[0].Split(' ');
                if (first.Length < 2) return;
                int len = 0;
                foreach (var l in lines) if (l.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) int.TryParse(l.Substring(15).Trim(), out len);
                len = Math.Min(len, 65536);
                var buf = new byte[len];
                for (int read = 0; read < len;) { int n = stream.Read(buf, read, len - read); if (n <= 0) break; read += n; }
                var uri = new Uri("http://lan" + first[1]);
                var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
                var path = Uri.UnescapeDataString(uri.AbsolutePath);
                int status; string type; byte[] body;
                if (path.StartsWith("/api/room/"))
                {
                    var r = Room(first[0], path, query["seat"], query["code"], Encoding.UTF8.GetString(buf), false);
                    status = r.Status; type = r.Type; body = Encoding.UTF8.GetBytes(r.Body);
                }
                else
                {
                    if (path == "/") path = "/play.html";
                    var full = Path.GetFullPath(Path.Combine(Root, path.TrimStart('/').Replace('/', '\\')));
                    // Friends only get the join page and the files it uses, never the host's own page
                    if (path.StartsWith("/api/") || path == "/index.html" || !full.StartsWith(Root, StringComparison.OrdinalIgnoreCase) || !File.Exists(full)) { status = 404; type = "text/plain"; body = Encoding.UTF8.GetBytes("Not found"); }
                    else { status = 200; if (!Mime.TryGetValue(Path.GetExtension(full), out type)) type = "application/octet-stream"; body = File.ReadAllBytes(full); }
                }
                var headBytes = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + " " + (status == 200 ? "OK" : "Error") + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.Length + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n");
                stream.Write(headBytes, 0, headBytes.Length);
                stream.Write(body, 0, body.Length);
            }
            catch { }
        }
    }

    static void Send(HttpListenerContext ctx, int status, string type, byte[] body, string header = null, string value = null)
    {
        var res = ctx.Response;
        try
        {
            res.StatusCode = status;
            res.ContentType = type;
            res.Headers["Cache-Control"] = "no-store";
            if (header != null) res.Headers[header] = value;
            res.ContentLength64 = body.Length;
            res.OutputStream.Write(body, 0, body.Length);
        }
        catch { }
        finally { try { res.Close(); } catch { } }
    }

    static void SendText(HttpListenerContext ctx, int status, string text)
    {
        Send(ctx, status, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(text));
    }
}
