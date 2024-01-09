using SeekableAesAssetBundle.Scripts;
using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

public class Decryptor : Editor
{
    [MenuItem("IKA9nt/EncrypterBundlePath")]
    static void EncrypterBundlePath()
    {
        string loadPath = Path.Combine(Application.persistentDataPath, "Encrypter");
        if (!Directory.Exists(loadPath))
            Directory.CreateDirectory(loadPath);
        Application.OpenURL(loadPath);
    }

    [MenuItem("IKA9nt/Decryptor")]
    static void Decrypt()
    {
        string loadPath = Path.Combine(Application.persistentDataPath, "Encrypter");
        string savePath = Path.Combine(Application.persistentDataPath, "Decryptor");
        if (!Directory.Exists(loadPath))
            return;
        if (!Directory.Exists(savePath))
            Directory.CreateDirectory(savePath);
        string arekFile = Path.Combine(loadPath, "AREK.txt");
        if (!File.Exists(arekFile))
            return;
        Regex r = new Regex(@"(\S+) (\S+) (\S+)\n", RegexOptions.Singleline);
        string arek = File.ReadAllText(arekFile).Replace(Environment.NewLine, "\n");
        foreach (Match m in r.Matches(arek))
        {
            string bundleLoadPath = Path.Combine(loadPath, m.Groups[3].Value);
            if (!File.Exists(bundleLoadPath))
            {
                Debug.Log("[IKA9nt.Decryptor] Bundle " + m.Groups[3] + " not found.");
                continue;
            }
            var fileStream = new FileStream(bundleLoadPath, FileMode.Open, FileAccess.Read);

            string bundleSavePath = Path.Combine(savePath, m.Groups[1].Value);
            if (File.Exists(bundleSavePath))
            {
                Debug.Log("[IKA9nt.Decryptor] Bundle " + m.Groups[3] + " skipped.");
                continue;
            }
            var bundlrStream = new SeekableAesStream(fileStream, m.Groups[2].Value, Encoding.UTF8.GetBytes(m.Groups[3].Value), 256);
            var saveStream = new FileStream(bundleSavePath, FileMode.Create, FileAccess.ReadWrite);
            bundlrStream.CopyTo(saveStream);
            Debug.Log("[IKA9nt.Decryptor] Bundle " + m.Groups[3] + " save as " + m.Groups[1] + ".");
            saveStream.Close();
            bundlrStream.Close();
            fileStream.Close();
            GC.Collect();
        }
        Application.OpenURL(savePath);
    }
}
