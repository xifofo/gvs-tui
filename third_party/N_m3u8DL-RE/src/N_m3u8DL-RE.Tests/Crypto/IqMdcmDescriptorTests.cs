using System.Text;
using N_m3u8DL_RE.Crypto;

namespace N_m3u8DL_RE.Tests.Crypto;

public class IqMdcmDescriptorTests
{
    private const string Vector = "00112233445566778899aabbccddeeff";

    [Theory]
    [InlineData("mdcm|s1:9:10|a0|v" + Vector + "|e1|fabcdef|")]
    [InlineData("a0|mdcm|v" + Vector + "|e1|fabcdef|gv|")]
    [InlineData("a0|v" + Vector + "|mdcm|s1:9:10|fabcdef|")]
    [InlineData("MDCM|S1:9:10|A0|V" + Vector + "|FABCDEF|")]
    public void AcceptsKnownMdcmLayouts(string descriptor)
    {
        var data = Pack(Section("salai 4.0.3", descriptor));
        var original = (byte[])data.Clone();
        Assert.True(IqBbtsUtil.DecryptInPlace(data, new byte[16]));
        Assert.Equal(original, data); // Metadata packets and TS framing stay intact.
    }

    [Fact]
    public void ReassemblesDescriptorAcrossTransportPackets()
    {
        // First 183-byte payload ends inside the mode/vector descriptor.
        var data = Pack(Section(new string('p', 138), "a0|mdcm|v" + Vector + "|fabcdef|gv|"));
        Assert.True(data.Length > 188);
        Assert.True(IqBbtsUtil.DecryptInPlace(data, new byte[16]));
    }

    [Theory]
    [InlineData("a0|mdcm|s1:5:10|v" + Vector + "|fabcdef|")]
    [InlineData("a0|munknown|v" + Vector + "|fabcdef|")]
    [InlineData("mdcm|v" + Vector + "|fabcdef|")]
    [InlineData("a0|mdcm|v001122|fabcdef|")]
    [InlineData("a0|mdcm|v00112233445566778899aabbccddeefg|fabcdef|")]
    [InlineData("a0|mdcm|fabcdef|")]
    public void RejectsUnverifiedPatternOrVector(string descriptor)
    {
        Assert.Throws<InvalidDataException>(() => IqBbtsUtil.DecryptInPlace(Pack(Section("salai", descriptor)), new byte[16]));
    }

    [Fact]
    public void ProviderNameCannotSupplyModeOrVector()
    {
        var data = Pack(Section("mdcm|s1:9:10|v" + Vector, "unrelated service"));
        Assert.False(IqBbtsUtil.DecryptInPlace(data, new byte[16]));
        Assert.Throws<InvalidDataException>(() => IqBbtsUtil.DecryptInPlace(Pack(Section("v" + Vector, "a0|mdcm|fabcdef|")), new byte[16]));
    }

    [Fact]
    public void DoesNotBorrowVectorFromFollowingServiceDescriptor()
    {
        var section = Section("salai", "mdcm|s1:9:10|a0|");
        var second = Section("salai", "a0|v" + Vector + "|fabcdef|");
        Assert.Throws<InvalidDataException>(() => IqBbtsUtil.DecryptInPlace(Pack(section).Concat(Pack(second)).ToArray(), new byte[16]));
    }

    [Fact]
    public void AcceptsOnlyCompleteDomesticWebLegacyTuple()
    {
        var legacy = "a0|v" + Vector + "|e1|fabcdef|";
        Assert.True(IqBbtsUtil.DecryptInPlace(Pack(Section("salai", legacy)), new byte[16]));
        foreach (var bad in new[] { legacy.Replace("e1", "e0"), legacy.Replace("abcdef", "abc"),
            legacy + "munknown|", legacy + "f012345|", legacy + "s1:5:10|" })
            Assert.Throws<InvalidDataException>(() => IqBbtsUtil.DecryptInPlace(Pack(Section("salai", bad)), new byte[16]));
    }

    private static byte[] Section(string provider, string name)
    {
        var p = Encoding.ASCII.GetBytes(provider);
        var n = Encoding.ASCII.GetBytes(name);
        var descriptor = new List<byte> { 0x48, checked((byte)(3 + p.Length + n.Length)), 1, checked((byte)p.Length) };
        descriptor.AddRange(p); descriptor.Add(checked((byte)n.Length)); descriptor.AddRange(n);
        var section = new List<byte> { 0x42, 0xf0, 0, 0, 1, 0xc1, 0, 0, 0, 1, 0xff, 0, 1, 0xff, (byte)(0x80 | (descriptor.Count >> 8)), (byte)descriptor.Count };
        section.AddRange(descriptor); section.AddRange(new byte[4]);
        var length = section.Count - 3; section[1] |= (byte)(length >> 8); section[2] = (byte)length;
        return section.ToArray();
    }

    private static byte[] Pack(byte[] section)
    {
        var packets = new List<byte>(); var offset = 0; var counter = 0;
        while (offset < section.Length)
        {
            var packet = Enumerable.Repeat((byte)0xff, 188).ToArray();
            packet[0] = 0x47; packet[1] = offset == 0 ? (byte)0x40 : (byte)0; packet[2] = 17; packet[3] = (byte)(0x10 | counter++ % 16);
            var start = offset == 0 ? 5 : 4; if (offset == 0) packet[4] = 0;
            var count = Math.Min(188 - start, section.Length - offset); section.AsSpan(offset, count).CopyTo(packet.AsSpan(start)); offset += count;
            packets.AddRange(packet);
        }
        return packets.ToArray();
    }
}
