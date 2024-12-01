using Il2CppIKA9nt.Encrypter;
using SeekableAesAssetBundle.Scripts;
using System.Text;
using UnityEngine;

namespace IKA9ntDecryptor
{
    /// <summary>
    ///  // <label, password>
    ///  Dictionary<string, string> PasswordMap.map
    ///  
    ///  // <label, (.hash)>
    ///  Dictionary<string, EncrypterKeyReference> EncrypterKeyData.reference
    ///  
    ///  // salt
    ///  Encoding.UTF8.GetBytes(hash)
    ///  
    /// // .CopyTo from
    /// new SeekableAesStream(fileStream, key, salt, 256)
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
            var map = Il2Cpp.PasswordMap.map;
            var reference = EncrypterCore.KeyData.reference;

            if (map != null && reference != null)
            {
                maxThread = int.TryParse(param, out int threads) ? threads : map.Count;
                CoreUX.Run("IKA9ntDecryptor", "WConvert " + maxThread + " files at same time");

                tasks = new();
                semaphore = new SemaphoreSlim(0, maxThread);

                string arek = "";

                if (!Directory.Exists(destDir))
                    Directory.CreateDirectory(destDir);

                foreach (var kv in map)
                {
                    arek += kv.Key + " " + kv.Value + " " + reference[kv.Key].hash + "\n";
                    tasks.Add(ConvertAB(kv.Key, kv.Value, reference[kv.Key].hash));
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

        private static async Task ConvertAB(string label, string key, long hash)
        {
            int semaphoreCount;
            await semaphore.WaitAsync();

            string file = Path.Combine(deptDir, string.Format("{0}", hash));
            string save = Path.Combine(destDir, label);
            byte[] salt = Encoding.UTF8.GetBytes(string.Format("{0}", hash));

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
    }
}
