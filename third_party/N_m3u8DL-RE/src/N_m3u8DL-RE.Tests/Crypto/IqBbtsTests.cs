using System.Buffers.Binary;
using System.Security.Cryptography;
using N_m3u8DL_RE.Crypto;

namespace N_m3u8DL_RE.Tests.Crypto;

public class IqBbtsTests
{
    [Theory]
    [InlineData(159)]
    [InlineData(160)]
    [InlineData(161)]
    [InlineData(175)]
    public void InnerCrcParticipatesInFinalAesBlockSelection(int payloadLength)
    {
        var key=Enumerable.Range(0,16).Select(i=>(byte)i).ToArray();
        var iv=Convert.FromHexString("0102030405060708090A0B0C00000000");
        var plain=Enumerable.Range(0,payloadLength).Select(i=>(byte)(32+i%170)).ToArray();
        var full=plain.Concat(new byte[]{0xa1,0xb2}).ToArray();
        using var aes=Aes.Create();aes.Key=key;aes.Padding=PaddingMode.None;
        var cipher=new byte[full.Length+2];
        for(var offset=0;offset<full.Length;offset+=16)
        {
            var block=offset/16;var counter=(byte[])iv.Clone();BinaryPrimitives.WriteUInt32BigEndian(counter.AsSpan(12), (uint)block+1);
            var stream=block%10==0 || offset+16>=full.Length ? aes.EncryptEcb(counter,PaddingMode.None):counter;
            for(var i=0;i<Math.Min(16,full.Length-offset);i++)cipher[offset+i]=(byte)(full[offset+i]^stream[i]);
        }
        cipher[^2]=0xcc;cipher[^1]=0xdd;
        Assert.Equal(plain,IqBbtsUtil.DecryptNal(cipher,iv,aes));
    }

    [Fact]
    public void ClearTransportStaysByteIdenticalAndInvalidKeyIsRejected()
    {
        var packet=new byte[188];packet[0]=0x47;
        var original=(byte[])packet.Clone();
        Assert.False(IqBbtsUtil.DecryptInPlace(packet,new byte[16]));
        Assert.Equal(original,packet);
        Assert.Throws<ArgumentException>(()=>IqBbtsUtil.DecryptInPlace(packet,new byte[15]));
    }
}
