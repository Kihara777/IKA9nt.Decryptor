using UnityEngine;

namespace IKA9ntDecryptor
{
    public class Utilities
    {
        public static string Screen(string param)
        {
            if (param.Contains("modes"))
            {
                string modes = "Display modes:";
                for (int i = 0; i < UnityEngine.Screen.resolutions.Length; i++)
                {
                    Resolution r = UnityEngine.Screen.resolutions[i];
                    modes += "\n[" + i + "] " + r.width + "x" + r.height + "@" + r.refreshRate + "Hz";
                }
                return modes;
            }
            else if (param.Contains("types"))
            {
                // MaximizedWindow will fallback to FullScreenWindow

                string content = "Fullscreen types:";
                content += "\n[" + (int)FullScreenMode.ExclusiveFullScreen + "] " + Enum.GetName(typeof(FullScreenMode), FullScreenMode.ExclusiveFullScreen);
                content += "\n[" + (int)FullScreenMode.FullScreenWindow + "] " + Enum.GetName(typeof(FullScreenMode), FullScreenMode.FullScreenWindow);
                content += "\n[" + (int)FullScreenMode.MaximizedWindow + "] " + Enum.GetName(typeof(FullScreenMode), FullScreenMode.MaximizedWindow);
                content += "\n[" + (int)FullScreenMode.Windowed + "] " + Enum.GetName(typeof(FullScreenMode), FullScreenMode.Windowed);
                return content;
            }
            else if (param.Split(' ').Length > 0 && param.Split(' ').Length < 3 && !string.IsNullOrEmpty(param.Replace(" ", "")))
            {
                Resolution r = UnityEngine.Screen.currentResolution;
                if (!int.TryParse(param.Split(' ')[0], out int index) || index < 0 || index >= UnityEngine.Screen.resolutions.Length)
                    return "Invalid mode index.\nUse modes for available codes.";

                FullScreenMode screenMode = UnityEngine.Screen.fullScreenMode;
                if (param.Split(' ').Length > 1 && int.TryParse(param.Split(' ')[1], out int types))
                {
                    if (Enum.IsDefined(typeof(FullScreenMode), types))
                        screenMode = (FullScreenMode)types;
                    else
                        return "Invalid mode index.\nUse types for available codes.";
                }

                UnityEngine.Screen.SetResolution(r.width, r.height, screenMode, r.refreshRate);
                return "Switch to " + r.width + "x" + r.height + "@" + r.refreshRate + "Hz (" + Enum.GetName(typeof(FullScreenMode), screenMode) + ")";

            }
            else
                return "Invalid param.\nFormat: screen [modes] [types]";
        }

        public static string Vsync(string param)
        {
            string echo = "Invalid vSyncCount.\nCheck Unity's [QualitySettings.vSyncCount] official API references for more details.";
            if (!int.TryParse(param, out int vsCnt) || vsCnt < 0 || vsCnt > 4)
                return echo;

            QualitySettings.vSyncCount = vsCnt;
            echo = "VerticalSync: ";
            echo += (vsCnt == 0) ? "Disabled" : "Enabled";
            if (vsCnt > 1)
                echo += " (" + vsCnt + " Frames)";

            return echo;
        }
    }
}
