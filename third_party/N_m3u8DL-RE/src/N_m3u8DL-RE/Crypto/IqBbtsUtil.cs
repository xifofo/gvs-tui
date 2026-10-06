using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace N_m3u8DL_RE.Crypto;

/// <summary>IQ s1:9:10 sparse AES framing, with per-NAL counters and native CRC order.</summary>
public static class IqBbtsUtil
{
    private const int Ts = 188;
    private sealed record Mapping(int PesOffset, int TsOffset, int Count);
    private sealed class Nal(int start, int body, int end)
    {
        public int Start = start, Body = body, End = end;
    }

    // Preserve the original TS skeleton, PCR and continuity counters. Extra
    // ciphertext escape/CRC bytes become Annex-B trailing_zero_8bits rather
    // than changing packet counts or timestamps at every segment boundary.
    public static bool DecryptFile(string path, byte[] key)
    {
        var bytes = File.ReadAllBytes(path);
        var changed = DecryptInPlace(bytes, key);
        if (changed) File.WriteAllBytes(path, bytes);
        return changed;
    }

    public static bool DecryptInPlace(byte[] data, byte[] key)
    {
        if (key.Length != 16) throw new ArgumentException("IQ BBTS requires a 16-byte content key");
        if (data.Length % Ts != 0 || data.Length < Ts) throw new InvalidDataException("Invalid IQ transport stream length");
        var match = Regex.Match(Encoding.ASCII.GetString(data), @"mdcm\|s1:9:10\|(?:[^|]*\|)?v([0-9a-f]{32})", RegexOptions.IgnoreCase);
        if (!match.Success)
        {
            if (Encoding.ASCII.GetString(data).Contains("mdcm|", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Unsupported IQ mdcm encryption pattern");
            return false; // The initial clear portion is part of the same video playlist.
        }
        var iv = Convert.FromHexString(match.Groups[1].Value);
        iv.AsSpan(12, 4).Clear();
        var (videoPid, headerBytes) = VideoPid(data);
        using var aes = Aes.Create();
        aes.Key = key;
        aes.Mode = CipherMode.ECB;
        aes.Padding = PaddingMode.None;
        using var pes = new MemoryStream();
        var mappings = new List<Mapping>();
        void Flush()
        {
            if (pes.Length == 0) return;
            var payload = pes.ToArray();
            DecryptPes(payload, iv, aes, headerBytes);
            foreach (var map in mappings)
                payload.AsSpan(map.PesOffset, map.Count).CopyTo(data.AsSpan(map.TsOffset, map.Count));
            pes.SetLength(0);
            mappings.Clear();
        }
        for (var offset = 0; offset < data.Length; offset += Ts)
        {
            if (data[offset] != 0x47) throw new InvalidDataException("Invalid IQ TS sync byte");
            var pid = ((data[offset + 1] & 31) << 8) | data[offset + 2];
            if (pid != videoPid) continue;
            var control = (data[offset + 3] >> 4) & 3;
            var body = 4;
            if ((control & 2) != 0) body += 1 + data[offset + 4];
            if ((control & 1) == 0 || body >= Ts) continue;
            if ((data[offset + 1] & 0x40) != 0) Flush();
            mappings.Add(new((int)pes.Length, offset + body, Ts - body));
            pes.Write(data, offset + body, Ts - body);
        }
        Flush();
        return true;
    }

    private static (int Pid, int HeaderBytes) VideoPid(byte[] data)
    {
        for (var offset = 0; offset + Ts <= data.Length; offset += Ts)
        {
            if (data[offset] != 0x47 || (data[offset + 1] & 0x40) == 0) continue;
            var control = (data[offset + 3] >> 4) & 3;
            var p = offset + 4;
            if ((control & 2) != 0) p += 1 + data[offset + 4];
            if ((control & 1) == 0 || p >= offset + Ts) continue;
            p += 1 + data[p];
            if (p + 12 >= offset + Ts || data[p] != 2) continue;
            var end = Math.Min(offset + Ts, p + 3 + ((data[p + 1] & 15) << 8) + data[p + 2] - 4);
            var element = p + 12 + ((data[p + 10] & 15) << 8) + data[p + 11];
            while (element + 5 <= end)
            {
                if (data[element] is 0x24 or 0x1b)
                    return (((data[element + 1] & 31) << 8) | data[element + 2], data[element] == 0x24 ? 2 : 1);
                element += 5 + ((data[element + 3] & 15) << 8) + data[element + 4];
            }
        }
        return (0x100, 2);
    }

    private static bool HasStartCode(byte[] data)
    {
        for (var i = 0; i + 2 < data.Length; i++)
            if (data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1) return true;
        return false;
    }

    private static byte[] Unescape(ReadOnlySpan<byte> input)
    {
        using var output = new MemoryStream(input.Length);
        for (var i = 0; i < input.Length; i++)
        {
            if (i + 2 < input.Length && input[i] == 0 && input[i + 1] == 0 && input[i + 2] == 3)
            {
                output.WriteByte(0);
                output.WriteByte(0);
                i += 2;
            }
            else output.WriteByte(input[i]);
        }
        return output.ToArray();
    }

    public static byte[] DecryptNal(ReadOnlySpan<byte> framed, byte[] iv, Aes aes)
    {
        var raw = Unescape(framed);
        if (raw.Length < 4) throw new InvalidDataException("Truncated IQ CRC frame");
        var count = raw.Length - 2; // Keep encrypted plaintext CRC until after AES selection.
        var result = new byte[count];
        Span<byte> counter = stackalloc byte[16];
        Span<byte> stream = stackalloc byte[16];
        var blocks = (count + 15) / 16;
        for (var j = 0; j < blocks; j++)
        {
            iv.AsSpan().CopyTo(counter);
            BinaryPrimitives.WriteUInt32BigEndian(counter[12..], (uint)j + 1);
            if (j % 10 == 0 || j == blocks - 1) aes.EncryptEcb(counter, stream, PaddingMode.None);
            else counter.CopyTo(stream);
            var take = Math.Min(16, count - j * 16);
            for (var k = 0; k < take; k++) result[j * 16 + k] = (byte)(raw[j * 16 + k] ^ stream[k]);
        }
        return result[..^2];
    }

    private static void DecryptPes(byte[] payload, byte[] iv, Aes aes, int headerBytes)
    {
        if (payload.Length < 9 || payload[0] != 0 || payload[1] != 0 || payload[2] != 1 || payload[3] != 0xe0) return;
        var header = 9 + payload[8];
        var bounds = new List<(int Start, int Body)>();
        for (var i = header; i + 3 + headerBytes < payload.Length; i++)
        {
            if (payload[i] != 0 || payload[i + 1] != 0 || payload[i + 2] != 1) continue;
            bounds.Add((i > header && payload[i - 1] == 0 ? i - 1 : i, i + 3 + headerBytes));
        }
        var nals = new List<Nal>();
        for (var i = 0; i < bounds.Count; i++)
        {
            var end = i + 1 < bounds.Count ? bounds[i + 1].Start : payload.Length;
            if (end - bounds[i].Body > 0) nals.Add(new(bounds[i].Start, bounds[i].Body, end));
        }
        for (var i = 1; i < nals.Count;)
        {
            var current = nals[i];
            if (current.End - current.Body >= 4 && HasStartCode(DecryptNal(payload.AsSpan(current.Body, current.End - current.Body), iv, aes)))
            {
                var previous = nals[i - 1];
                if (!HasStartCode(DecryptNal(payload.AsSpan(previous.Body, current.End - previous.Body), iv, aes)))
                {
                    previous.End = current.End;
                    nals.RemoveAt(i);
                    continue;
                }
            }
            i++;
        }
        foreach (var nal in nals)
        {
            var plain = DecryptNal(payload.AsSpan(nal.Body, nal.End - nal.Body), iv, aes);
            plain.CopyTo(payload.AsSpan(nal.Body));
            payload.AsSpan(nal.Body + plain.Length, nal.End - nal.Body - plain.Length).Clear();
        }
    }
}
