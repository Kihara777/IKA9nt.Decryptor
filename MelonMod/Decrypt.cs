using Il2CppIKA9nt.Encrypter;
using SeekableAesAssetBundle.Scripts;
using System.Reflection;
using System.Text;
using UnityEngine;

namespace IKA9ntDecryptor
{
    /// <summary>
    ///  v1.9:
    ///  // <label, password>
    ///  Dictionary<string, string> PasswordMap.map (static)
    ///  password = map[label], salt = Encoding.UTF8.GetBytes(hash)
    ///
    ///  v2.1+ (AIdealRays Ver_2.1):
    ///  // PasswordMap.map is now an INSTANCE property behind EncrypterCore.passwordMap,
    ///  // and map values are NO LONGER the passwords - they are raw material.
    ///  // true password = EncrypterCore.GetPasswordFromMap(out password, label) (private static)
    ///  // true salt     = EncrypterCore.GetSalt(label) (private static)
    ///  // Figures out a 195-char alphabet (0-9a-zA-Z + hiragana + katakana + halfwidth katakana)
    ///  // via PasswordMap.Substring(i) / PasswordCharacterSubstring(i) to derive it.
    ///
    ///  // <label, (.hash)>
    ///  Dictionary<string, EncrypterKeyReference> EncrypterKeyData.reference (unchanged)
    ///
    /// // .CopyTo from (game's own stream - Cipher unchanged, safe to reuse as-is)
    /// new SeekableAesStream(fileStream, password, salt, 256)
    ///
    ///  NOTE: version-dependent members are resolved via reflection so this file compiles
    ///  against both v1.9 and v2.1 unhollowed assemblies. All derivation runs on the calling
    ///  thread; worker tasks only touch the same stream surface v1.9 already used.
    /// </summary>
    public static class Decrypt
    {
        private static SemaphoreSlim semaphore;
        private static List<Task> tasks;
        private static int maxThread;

        private static bool onHold;

        private static string deptDir = Path.Combine(Application.streamingAssetsPath, "StandaloneWindows64");
        private static string destDir = Path.Combine(Application.persistentDataPath, "Decryptor");
        private static string arekDir = Path.Combine(Application.persistentDataPath, "Encrypter");

        public static string Decryptor(string param)
        {
            if (param == "help")
                return "I_HAVE_CONTROL [threads]";

            if (onHold)
                return "WIP!";
            onHold = true;
            AREKAsync(param).Start();
            return "Processing...";
        }

        private static async Task AREKAsync(string param)
        {
            // v2.1+: instance map (managed copy); v1.9: static map (managed copy).
            var rawPasswords = ResolveRawPasswords();
            var reference = EncrypterCore.KeyData.reference;

            if (rawPasswords.Count > 0 && reference != null)
            {
                maxThread = int.TryParse(param, out int threads) ? threads : rawPasswords.Count;
                CoreUX.Run("IKA9ntDecryptor", "WConvert " + maxThread + " files at same time");

                tasks = new();
                semaphore = new SemaphoreSlim(0, maxThread);

                string arek = "";

                if (!Directory.Exists(destDir))
                    Directory.CreateDirectory(destDir);

                foreach (var kv in rawPasswords)
                {
                    string label = kv.Key;
                    long hash = reference[label].hash;
                    // Derive TRUE credentials up-front (v2.1), so worker tasks below only use
                    // the same Il2Cpp stream surface v1.9 already relied on.
                    string password = ResolvePassword(label, kv.Value);
                    byte[] salt = ResolveSalt(label, hash);
                    arek += label + " " + password + " " + hash + "\n";
                    tasks.Add(ConvertAB(label, password, salt, hash));
                }

                if (!Directory.Exists(arekDir))
                    Directory.CreateDirectory(arekDir);
                string arekFile = Path.Combine(arekDir, "AREK.txt");
                await File.WriteAllTextAsync(arekFile, arek);

                Thread.Sleep(500);
                semaphore.Release(maxThread);
                await Task.WhenAll(tasks.ToArray()).ContinueWith(t =>
                {
                    CoreUX.Run("IKA9ntDecryptor", "All done!");
                    onHold = false;
                });
            }
            else
            {
                CoreUX.Run("IKA9ntDecryptor", "FAILED...");
                onHold = false;
            }
        }

        private static async Task ConvertAB(string label, string key, byte[] salt, long hash)
        {
            int semaphoreCount;
            await semaphore.WaitAsync();

            string file = Path.Combine(deptDir, string.Format("{0}", hash));
            string save = Path.Combine(destDir, label);

            CoreUX.Run(label, "Decrypting...");

            var fileStream = new FileStream(file, FileMode.Open, FileAccess.Read);
            var bundleStream = new SeekableAesStream(fileStream, key, salt, 256);
            var saveStream = new FileStream(save, FileMode.Create, FileAccess.ReadWrite);
            await bundleStream.CopyToAsync(saveStream).ContinueWith(t =>
            {
                saveStream.Close();
                bundleStream.Close();
                fileStream.Close();

                CoreUX.Run("IKA9ntDecryptor", hash + " -> " + label + "(" + key + "):\n" + save);
                semaphoreCount = semaphore.Release();
            });
        }

        // ---- v2.1+ support (reflection: compiles against v1.9 and v2.1 assemblies) ----

        // <label, raw map value>. v2.1: EncrypterCore.passwordMap.map (instance);
        // v1.9: PasswordMap.map (static). Returned as a managed copy.
        private static Dictionary<string, string> ResolveRawPasswords()
        {
            var result = new Dictionary<string, string>();
            try
            {
                object mapObj = null;
                try
                {
                    // v2.1+ instance path
                    var pwProp = typeof(EncrypterCore).GetProperty("passwordMap",
                        BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                    var pwMap = pwProp?.GetValue(null);
                    var mapProp = pwMap?.GetType().GetProperty("map",
                        BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    mapObj = mapProp?.GetValue(pwMap);
                }
                catch { }
                if (mapObj == null)
                {
                    // v1.9 static path
                    var mapProp = typeof(Il2Cpp.PasswordMap).GetProperty("map",
                        BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                    mapObj = mapProp?.GetValue(null);
                }
                if (mapObj is System.Collections.IEnumerable entries)
                {
                    foreach (object entry in entries)
                    {
                        var t = entry.GetType();
                        string key = t.GetProperty("Key")?.GetValue(entry)?.ToString();
                        string val = t.GetProperty("Value")?.GetValue(entry)?.ToString();
                        if (key != null && val != null)
                            result[key] = val;
                    }
                }
            }
            catch { }
            return result;
        }

        // TRUE password. v2.1: EncrypterCore.GetPasswordFromMap(out password, label)
        // (private static); falls back to the raw map value (v1.9 behavior).
        private static string ResolvePassword(string label, string rawValue)
        {
            try
            {
                var m = typeof(EncrypterCore).GetMethod("GetPasswordFromMap",
                    BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                if (m != null)
                {
                    object[] args = new object[] { "", label };
                    m.Invoke(null, args);
                    string pw = args[0]?.ToString();
                    if (!string.IsNullOrEmpty(pw))
                        return pw;
                }
            }
            catch { }
            return rawValue;
        }

        // TRUE salt. v2.1: EncrypterCore.GetSalt(label) (private static);
        // falls back to UTF8 bytes of the hash (v1.9 behavior).
        private static byte[] ResolveSalt(string label, long hash)
        {
            byte[] fallback = Encoding.UTF8.GetBytes(string.Format("{0}", hash));
            try
            {
                var m = typeof(EncrypterCore).GetMethod("GetSalt",
                    BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                if (m != null)
                    return ToManagedBytes(m.Invoke(null, new object[] { label }), fallback);
            }
            catch { }
            return fallback;
        }

        private static byte[] ToManagedBytes(object arr, byte[] fallback)
        {
            try
            {
                if (arr is byte[] b) return b;
                if (arr is System.Collections.Generic.IList<byte> glist)
                {
                    var r = new byte[glist.Count];
                    for (int i = 0; i < glist.Count; i++) r[i] = glist[i];
                    return r;
                }
                if (arr is System.Collections.IList list)
                {
                    var r = new byte[list.Count];
                    for (int i = 0; i < list.Count; i++) r[i] = System.Convert.ToByte(list[i]);
                    return r;
                }
            }
            catch { }
            return fallback;
        }
    }
}
