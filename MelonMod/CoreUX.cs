using UnityEngine;

namespace IKA9ntDecryptor
{
    [MelonLoader.RegisterTypeInIl2Cpp]
    public class CoreUX : MonoBehaviour
    {
        public CoreUX(IntPtr ptr) : base(ptr) { }
        public CoreUX() : base(Il2CppInterop.Runtime.Injection.ClassInjector.DerivedConstructorPointer<CoreUX>())
        {
            Il2CppInterop.Runtime.Injection.ClassInjector.DerivedConstructorBody(this);
        }

        private static Dictionary<string, Func<string, string>> commands = new Dictionary<string, Func<string, string>>();
        private static Dictionary<string, int> collapseDic = new Dictionary<string, int>();
        private static List<string> buffer = new List<string>();

        private static CoreUX Instance { get; set; }

        private GUIStyle inputStyle;
        private GUIStyle labelStyle;
        private GUIStyle toggleStyle;
        private GUIStyle bStyle;

        private string inputstring = "";
        private Vector2 scrollPosition;
        private bool unityOnGUICheckSucks = false;

        private List<string> history = new List<string>();
        private int currentHistory;

        private bool visible = true;

        private bool enterFlag;
        private bool clearFlag;
        private bool collapse;

        private void OnDestroy()
        {
            Rip("help");
            Rip("clear");
        }
        private void LateUpdate()
        {
            // https://docs.unity3d.com/ja/2019.4/ScriptReference/Input-inputString.html
            foreach (char c in Input.inputString)
            {
                if (c == '\b')
                {
                    if (inputstring.Length != 0)
                    {
                        inputstring = inputstring.Substring(0, inputstring.Length - 1);
                    }
                }
                else if ((c == '\n') || (c == '\r'))
                {
                    enterFlag = true;
                }
                else if (c == '`')
                {
                    visible = !visible;
                }
                else if (c == '<')
                {
                    currentHistory = Mathf.Clamp(currentHistory - 1, 0, history.Count - 1);
                    inputstring = history[currentHistory];
                }
                else if (c == '>')
                {
                    currentHistory = Mathf.Clamp(currentHistory + 1, 0, history.Count - 1);
                    inputstring = history[currentHistory];
                }
                else if (visible)
                {
                    inputstring += c;
                }
            }
        }

        public void OnGUI()
        {
            if (!unityOnGUICheckSucks)
            {
                unityOnGUICheckSucks = true;
                inputStyle = GUI.skin.textField;
                inputStyle.fontSize = 39;

                labelStyle = GUI.skin.box;
                labelStyle.alignment = TextAnchor.UpperLeft;
                labelStyle.fontSize = 39;

                bStyle = GUI.skin.box;

                toggleStyle = GUI.skin.toggle;
                toggleStyle.alignment = TextAnchor.MiddleLeft;
                toggleStyle.fontSize = 39;
            }
            if (visible)
            {
                GUI.Box(new Rect(0, 0, UnityEngine.Screen.width, UnityEngine.Screen.height), "", bStyle);
                GUILayout.BeginArea(new Rect(0f, 0f, UnityEngine.Screen.width, UnityEngine.Screen.height));
                GUILayout.BeginVertical();

                GUILayout.BeginHorizontal();
                collapse = GUILayout.Toggle(collapse, (collapse ? "Combine" : "Split") + " Outputs", labelStyle);
                if (GUILayout.Button("Persistent Data", labelStyle))
                    Application.OpenURL(Application.persistentDataPath);
                GUILayout.EndHorizontal();

                GUILayout.Box(inputstring, inputStyle);

                scrollPosition = GUILayout.BeginScrollView(scrollPosition);
                if (!collapse)
                {
                    for (int i = buffer.Count - 1; i >= 0; i--)
                    {
                        string echo = "<color=#ffffffAA><size=24>" + buffer[i] + "</size></color>";
                        GUILayout.Box(echo, labelStyle);
                    }
                }
                else
                {
                    var collapsed = collapseDic.Keys.ToArray();
                    for (int i = collapsed.Length - 1; i >= 0; i--)
                    {
                        string k = collapsed[i];
                        int v = collapseDic[k];
                        string echo = "<color=#ffffffAA><size=24>" + k + "\n</size></color>" + (v > 1 ? ("> +" + v) : "> 1");
                        GUILayout.Box(echo, labelStyle);
                    }
                }
                GUILayout.EndScrollView();

                GUILayout.EndVertical();
                GUILayout.EndArea();

                if (enterFlag)
                {
                    enterFlag = false;
                    history.Add(inputstring);
                    foreach (string s in inputstring.Replace("  ", "\n").Split('\n'))
                    {
                        string c = s.Split(' ')[0];
                        string p = s.Substring(Mathf.Min(c.Length + 1, s.Length));
                        Run(c, p);
                    }
                    inputstring = "";
                    currentHistory = history.Count;
                    if (clearFlag)
                    {
                        buffer.Clear();
                        collapseDic.Clear();
                        clearFlag = false;
                    }
                }
            }
        }

        public static void Init()
        {
            if (Instance)
                return;

            GameObject holder = new("CoreUX");
            DontDestroyOnLoad(holder);
            holder.hideFlags = HideFlags.HideAndDontSave;
            Instance = holder.AddComponent<CoreUX>();

            Reg("help", Instance.Help);
            Reg("clear", Instance.Clear);

            Run("CoreMod.UX", "IKA9ntDecryptor by Kitsunori, I have control.");
        }
        public static void Purge()
        {
            if (!Instance)
                return;

            Destroy(Instance.gameObject);
            Il2CppSystem.GC.Collect();
        }

        public static void Reg(string c, Func<string, string> f) { commands.Add(c, f); }
        public static void Rip(string c) { commands.Remove(c); }
        public static void Run(string c, string p)
        {
            if (!Instance)
                return;

            string bEcho = "";
            string fEcho = "";
            int qty = 1;
            if (!commands.TryGetValue(c, out var f))
            {
                bEcho = p + "\n< " + c;
                fEcho = p;
            }
            else
            {
                fEcho = f.Invoke(p);
                bEcho = fEcho + "\n< " + c + " " + p;
            }

            buffer.Add(bEcho);
            if (collapseDic.ContainsKey(fEcho))
            {
                qty += collapseDic[fEcho];
                collapseDic.Remove(fEcho);
            }
            collapseDic.Add(fEcho, qty);
        }

        private string Help(string _)
        {
            string help = "Available commands: \n<color=#00ffff><b> ";
            foreach (var s in commands.Keys.OrderBy(k => k))
                help += s + " ";
            help += "</b></color>\nUse half-width dual space to split multiple commands;";
            help += "\nUse \"<\" and \">\" to view history;";
            help += "\nYou have control.";
            return help;
        }
        private string Clear(string param)
        {
            if (param.ToLower() == "history")
            {
                history.Clear();
                currentHistory = 0;
                return "History cleared.";
            }
            clearFlag = true;
            return "Cleared.";
        }
    }
}
