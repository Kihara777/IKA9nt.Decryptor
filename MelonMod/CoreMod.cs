using MelonLoader;
using UnityEngine;

[assembly: MelonInfo(typeof(IKA9ntDecryptor.CoreMod), "IKA9ntDecryptor", "1.0.0", "Kitsunori", null)]
[assembly: MelonGame("Riez-On", "AldealRays")]

namespace IKA9ntDecryptor
{
    public class CoreMod : MelonMod
    {
        public override void OnLateInitializeMelon()
        {
            CoreUX.Init();

            CoreUX.Reg("I_HAVE_CONTROL", Decrypt.Decryptor);

            CoreUX.Reg("screen", Utilities.Screen);
            CoreUX.Reg("vsync", Utilities.Vsync);
        }

        public override void OnDeinitializeMelon()
        {
            CoreUX.Rip("vsync");
            CoreUX.Rip("screen");

            CoreUX.Rip("I_HAVE_CONTROL");

            CoreUX.Purge();
        }
    }
}
