using System.Text;
using System.Text.RegularExpressions;

namespace N_m3u8DL_RE.Crypto;

/// <summary>Reads the mdcm fields from the SDT service name, including split sections.</summary>
internal static class IqMdcmDescriptor
{
    internal static byte[]? ReadIv(byte[] data)
    {
        byte[]? iv = null;
        var pending = new List<byte>();
        var expected = 0;
        void Append(ReadOnlySpan<byte> payload)
        {
            foreach (var value in payload)
            {
                if (pending.Count == 0 && value == 0xff) return;
                pending.Add(value);
                if (pending.Count == 3)
                {
                    expected = 3 + ((pending[1] & 15) << 8) + pending[2];
                    if (expected > 4096 || expected < 3) throw new InvalidDataException("Invalid IQ SDT section length");
                }
                if (expected != 0 && pending.Count == expected)
                {
                    var found = ReadSection(pending.ToArray());
                    if (found != null)
                    {
                        if (iv != null && !iv.AsSpan().SequenceEqual(found))
                            throw new InvalidDataException("Multiple IQ mdcm vectors in one segment");
                        iv = found;
                    }
                    pending.Clear(); expected = 0;
                }
            }
        }
        for (var offset = 0; offset < data.Length; offset += 188)
        {
            if (data[offset] != 0x47) throw new InvalidDataException("Invalid IQ TS sync byte");
            if ((((data[offset + 1] & 31) << 8) | data[offset + 2]) != 17) continue;
            var control = (data[offset + 3] >> 4) & 3;
            if ((control & 1) == 0) continue;
            var start = 4;
            if ((control & 2) != 0) start += 1 + data[offset + 4];
            if (start > 188) throw new InvalidDataException("Invalid IQ SDT adaptation length");
            if (start == 188) continue;
            var payload = data.AsSpan(offset + start, 188 - start);
            if ((data[offset + 1] & 0x40) != 0)
            {
                var pointer = payload[0]; payload = payload[1..];
                if (pointer > payload.Length) throw new InvalidDataException("Invalid IQ SDT pointer");
                if (pending.Count != 0)
                {
                    Append(payload[..pointer]);
                    if (pending.Count != 0) throw new InvalidDataException("Truncated IQ SDT section");
                }
                Append(payload[pointer..]);
            }
            else if (pending.Count != 0) Append(payload);
        }
        if (pending.Count != 0 && pending[0] is 0x42 or 0x46)
            throw new InvalidDataException("Truncated IQ SDT section");
        return iv;
    }

    private static byte[]? ReadSection(byte[] section)
    {
        if (section[0] is not (0x42 or 0x46)) return null;
        var end = section.Length - 4; // The CRC is outside all descriptor text.
        if (end < 11) throw new InvalidDataException("Invalid IQ SDT section length");
        byte[]? result = null;
        for (var service = 11; service < end;)
        {
            if (service + 5 > end) throw new InvalidDataException("Invalid IQ SDT service length");
            var loopEnd = service + 5 + ((section[service + 3] & 15) << 8) + section[service + 4];
            if (loopEnd > end) throw new InvalidDataException("Invalid IQ SDT descriptor loop");
            for (var descriptor = service + 5; descriptor < loopEnd;)
            {
                if (descriptor + 2 > loopEnd) throw new InvalidDataException("Invalid IQ SDT descriptor length");
                var body = descriptor + 2; var descEnd = body + section[descriptor + 1];
                if (descEnd > loopEnd) throw new InvalidDataException("Invalid IQ SDT descriptor length");
                if (section[descriptor] == 0x48)
                {
                    if (body + 2 > descEnd) throw new InvalidDataException("Invalid IQ SDT service descriptor");
                    var nameLength = body + 2 + section[body + 1];
                    if (nameLength >= descEnd || nameLength + 1 + section[nameLength] > descEnd)
                        throw new InvalidDataException("Invalid IQ SDT service name length");
                    var found = ReadName(Encoding.ASCII.GetString(section, nameLength + 1, section[nameLength]));
                    if (found != null)
                    {
                        if (result != null && !result.AsSpan().SequenceEqual(found))
                            throw new InvalidDataException("Multiple IQ mdcm vectors in one section");
                        result = found;
                    }
                }
                descriptor = descEnd;
            }
            service = loopEnd;
        }
        return result;
    }

    private static byte[]? ReadName(string name)
    {
        var terminator = name.IndexOf("|gv|", StringComparison.OrdinalIgnoreCase);
        if (terminator >= 0) name = name[..terminator];
        var fields = name.Split('|', StringSplitOptions.RemoveEmptyEntries);
        if (!fields.Any(f => f.Equals("mdcm", StringComparison.OrdinalIgnoreCase)))
        {
            // Domestic Web/Puma's verified legacy layout implies the same
            // sparse scheme only for the complete a0/vector/e1/content tuple.
            var legacy = Regex.Match(name, @"^a0\|v(?<iv>[0-9a-f]{32})\|e1\|f(?<content>[0-9a-f]{6})(?:\||$)", RegexOptions.IgnoreCase);
            if (legacy.Success && !fields.Any(f => f[0] is 'm' or 'M'))
            {
                foreach (var field in fields)
                {
                    if (Regex.IsMatch(field, @"^f[0-9a-f]{6}$", RegexOptions.IgnoreCase) &&
                        !field[1..].Equals(legacy.Groups["content"].Value, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("Conflicting IQ Web content descriptors");
                    if (field[0] is 's' or 'S' && !field.Equals("s1:9:10", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("Unsupported IQ mdcm encryption pattern");
                }
                var legacyIv = Convert.FromHexString(legacy.Groups["iv"].Value);
                legacyIv.AsSpan(12, 4).Clear();
                return legacyIv;
            }
            if (fields.Any(f => f.Equals("a0", StringComparison.OrdinalIgnoreCase)))
                throw new InvalidDataException("Unsupported IQ mdcm encryption mode");
            return null;
        }
        if (!fields.Any(f => f.Equals("s1:9:10", StringComparison.OrdinalIgnoreCase)) &&
            !fields.Any(f => f.Equals("a0", StringComparison.OrdinalIgnoreCase)))
            throw new InvalidDataException("Unsupported IQ mdcm encryption pattern");
        string? vector = null;
        foreach (var field in fields)
        {
            if (field[0] is 's' or 'S' && !field.Equals("s1:9:10", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Unsupported IQ mdcm encryption pattern");
            if (field[0] is not ('v' or 'V')) continue;
            if (vector != null || field.Length != 33 || !field.AsSpan(1).ContainsOnlyHex())
                throw new InvalidDataException("Invalid IQ mdcm vector");
            vector = field[1..];
        }
        if (vector == null) throw new InvalidDataException("Missing IQ mdcm vector");
        var iv = Convert.FromHexString(vector); iv.AsSpan(12, 4).Clear(); return iv;
    }

    private static bool ContainsOnlyHex(this ReadOnlySpan<char> value)
    {
        foreach (var c in value) if (!char.IsAsciiHexDigit(c)) return false;
        return true;
    }
}
