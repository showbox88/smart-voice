# Creates a Start Menu shortcut with a specific AppUserModelID so Electron
# toasts from dev-mode persist in the Windows Action Center.
#
# Invoked by scripts/setup-windows-notifications.js — don't call directly.

param(
  [Parameter(Mandatory=$true)] [string]$ShortcutPath,
  [Parameter(Mandatory=$true)] [string]$TargetPath,
  [Parameter(Mandatory=$true)] [string]$WorkingDir,
  [Parameter(Mandatory=$true)] [string]$AppId
)

$ErrorActionPreference = "Stop"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $TargetPath
$shortcut.Arguments = '"' + $WorkingDir + '"'
$shortcut.WorkingDirectory = $WorkingDir
$shortcut.Save()

$source = @"
using System;
using System.Runtime.InteropServices;

public static class ShortcutAppId {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHGetPropertyStoreFromParsingName(
        [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
        IntPtr pbc, int flags,
        [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ppv);

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        int GetCount(out uint cProps);
        int GetAt(uint iProp, out PropertyKey pkey);
        int GetValue(ref PropertyKey key, out PropVariant pv);
        int SetValue(ref PropertyKey key, ref PropVariant pv);
        int Commit();
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    struct PropertyKey { public Guid fmtid; public uint pid; }

    [StructLayout(LayoutKind.Sequential)]
    struct PropVariant {
        public ushort vt;
        public ushort wReserved1, wReserved2, wReserved3;
        public IntPtr p;
        public int i;
    }

    [DllImport("ole32.dll", PreserveSig = false)]
    static extern void PropVariantClear(ref PropVariant pvar);

    public static void Set(string lnkPath, string appId) {
        Guid iid = new Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99");
        IPropertyStore ps;
        SHGetPropertyStoreFromParsingName(lnkPath, IntPtr.Zero, 2, iid, out ps);
        PropertyKey key = new PropertyKey {
            fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
            pid = 5
        };
        PropVariant pv = new PropVariant {
            vt = 31,
            p = Marshal.StringToCoTaskMemUni(appId)
        };
        ps.SetValue(ref key, ref pv);
        ps.Commit();
        PropVariantClear(ref pv);
        Marshal.ReleaseComObject(ps);
    }
}
"@

Add-Type -TypeDefinition $source -Language CSharp
[ShortcutAppId]::Set($ShortcutPath, $AppId)

Write-Host "[setup-notifications] Shortcut: $ShortcutPath"
Write-Host "[setup-notifications] AppUserModelID: $AppId"
