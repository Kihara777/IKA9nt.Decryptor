// Reference:
//     How to add seek and position capabilities to CryptoStream
//         - https://stackoverflow.com/questions/5026409/how-to-add-seek-and-position-capabilities-to-cryptostream

// Original Source
//     - https://github.com/mao-test-h/SeekableAesAssetBundle

// MIT License
// Copyright(c) 2019 mao-test-h

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.



namespace SeekableAesAssetBundle.Scripts
{
    using System;
    using System.IO;
    using System.Security.Cryptography;

    public class SeekableAesStream : Stream
    {
        readonly Stream _baseStream;
        readonly RijndaelManaged _aes;
        readonly ICryptoTransform _encryptor;

        public bool AutoDisposeBaseStream { get; set; } = true;

        public SeekableAesStream(Stream baseStream, string password, byte[] salt, int keySize = 128, CipherMode cipherMode = CipherMode.ECB, PaddingMode paddingMode = PaddingMode.None)
        {
            _baseStream = baseStream;
            using (var key = new Rfc2898DeriveBytes(password.Trim(), salt))
            {
                _aes = new RijndaelManaged
                {
                    KeySize = keySize,
                    Mode = cipherMode,
                    Padding = paddingMode
                };
                _aes.Key = key.GetBytes(_aes.KeySize / 8);
                // zero buffer is adequate since we have to use new salt for each stream
                // ※Stream毎に新しいsaltを使用する必要があるためにゼロバッファが適切
                _aes.IV = new byte[16];
                _encryptor = _aes.CreateEncryptor(_aes.Key, _aes.IV);
            }
        }


        void Cipher(byte[] buffer, int offset, int count, long streamPos)
        {
            // find block number
            // ※ブロック番号の検索
            var blockSizeInByte = _aes.BlockSize / 8;
            var blockNumber = (streamPos / blockSizeInByte) + 1;
            var keyPos = streamPos % blockSizeInByte;

            // buffer
            var outBuffer = new byte[blockSizeInByte];
            var nonce = new byte[blockSizeInByte];
            var init = false;

            for (var i = offset; i < count; i++)
            {
                // encrypt the nonce to form next xro buffer(unique key)
                // ※nonceを暗号化して次のxorバッファを作成
                if (!init || (keyPos % blockSizeInByte) == 0)
                {
                    BitConverter.GetBytes(blockNumber).CopyTo(nonce, 0);
                    _encryptor.TransformBlock(nonce, 0, nonce.Length, outBuffer, 0);
                    if (init) keyPos = 0;
                    init = true;
                    blockNumber++;
                }
                buffer[i] ^= outBuffer[keyPos];
                keyPos++;
            }
        }

        private long _position;

        public override bool CanRead => _baseStream.CanRead;
        public override bool CanSeek => _baseStream.CanSeek;
        public override bool CanWrite => _baseStream.CanWrite;
        public override long Length => _baseStream.Length;
        public override long Position
        {
            get
            {
                if (_baseStream != null)
                    return _baseStream.Position;
                else
                    return _position;
            }
            set
            {
                if (_baseStream != null)
                    _baseStream.Position = value;
                else
                    _position = value;
            }
        }
        public override void Flush() => _baseStream.Flush();
        public override void SetLength(long value) => _baseStream.SetLength(value);
        public override long Seek(long offset, SeekOrigin origin) => _baseStream.Seek(offset, origin);

        public override int Read(byte[] buffer, int offset, int count)
        {
            var streamPos = Position;
            var ret = _baseStream.Read(buffer, offset, count);
            Cipher(buffer, offset, count, streamPos);
            return ret;
        }

        public int Read(byte[] buffer, int offset, int count, long length)
        {
            //if (_position >= length)
            //    return 0;

            var streamPos = Position;
            Cipher(buffer, offset, count, streamPos);
            if (length < _position + count)
            {
                int temp = (int)(length - _position);
                _position = length;
                return temp;
            }
            else
            {
                _position += count;
                return count;
            }

        }

        public override void Write(byte[] buffer, int offset, int count)
        {
            if (_baseStream != null)
            {
                Cipher(buffer, offset, count, Position);
                _baseStream.Write(buffer, offset, count);
            }
            else
            {
                Cipher(buffer, offset, count, 0);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _encryptor?.Dispose();
                _aes?.Dispose();
                if (AutoDisposeBaseStream)
                {
                    _baseStream?.Dispose();
                }
            }
            base.Dispose(disposing);
        }
    }
}
