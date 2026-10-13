using N_m3u8DL_RE.Common.Enum;
using N_m3u8DL_RE.Parser.Config;
using N_m3u8DL_RE.Parser.Constants;
using System.Text.RegularExpressions;

namespace N_m3u8DL_RE.Parser.Processor.HLS;

public partial class DefaultHLSContentProcessor : ContentProcessor
{
    [GeneratedRegex("#EXT-X-DISCONTINUITY\\s+#EXT-X-MAP:URI=\\\"(.*?)\\\",BYTERANGE=\\\"(.*?)\\\"")]
    private static partial Regex YkDVRegex();
    [GeneratedRegex("#EXT-X-MAP:URI=\\\".*?BUMPER/[\\s\\S]+?#EXT-X-DISCONTINUITY")]
    private static partial Regex DNSPRegex();
    [GeneratedRegex(@"#EXTINF:.*?,\s+.*BUMPER.*\s+?#EXT-X-DISCONTINUITY")]
    private static partial Regex DNSPSubRegex();
    [GeneratedRegex("(#EXTINF.*)(\\s+)(#EXT-X-KEY.*)")]
    private static partial Regex OrderFixRegex();
    [GeneratedRegex(@"#EXT-X-MAP.*\.apple\.com/")]
    private static partial Regex ATVRegex();
    [GeneratedRegex(@"(#EXT-X-KEY:[\s\S]*?)(#EXT-X-DISCONTINUITY|#EXT-X-ENDLIST)")]
    private static partial Regex ATVRegex2();
    [GeneratedRegex(@"^https?://[^\s?#]*\.apple\.com/[^\s?#]*\.webvtt", RegexOptions.Multiline)]
    private static partial Regex ATVSubRegex();

    public override bool CanProcess(ExtractorType extractorType, string rawText, ParserConfig parserConfig) => extractorType == ExtractorType.HLS;

    public override string Process(string m3u8Content, ParserConfig parserConfig)
    {
        // 处理content以\r作为换行符的情况
        if (m3u8Content.Contains('\r') && !m3u8Content.Contains('\n'))
        {
            m3u8Content = m3u8Content.Replace("\r", Environment.NewLine);
        }

        var m3u8Url = parserConfig.Url;
        // YSP回放
        if (m3u8Url.Contains("tlivecloud-playback-cdn.ysp.cctv.cn") && m3u8Url.Contains("endtime="))
        {
            m3u8Content += Environment.NewLine + HLSTags.ext_x_endlist;
        }

        // IMOOC
        if (m3u8Url.Contains("imooc.com/"))
        {
            // M3u8Content = DecodeImooc.DecodeM3u8(M3u8Content);
        }

        // 针对YK #EXT-X-VERSION:7杜比视界片源修正
        if (m3u8Content.Contains("#EXT-X-DISCONTINUITY") && m3u8Content.Contains("#EXT-X-MAP") && m3u8Content.Contains("ott.cibntv.net") && m3u8Content.Contains("ccode="))
        {
            var ykmap = YkDVRegex();
            foreach (Match m in ykmap.Matches(m3u8Content))
            {
                m3u8Content = m3u8Content.Replace(m.Value, $"#EXTINF:0.000000,\n#EXT-X-BYTERANGE:{m.Groups[2].Value}\n{m.Groups[1].Value}");
            }
        }

        // 针对Disney+修正
        if (m3u8Content.Contains("#EXT-X-DISCONTINUITY") && m3u8Content.Contains("#EXT-X-MAP") && m3u8Url.Contains("media.dssott.com/"))
        {
            Regex ykmap = DNSPRegex();
            if (ykmap.IsMatch(m3u8Content))
            {
                m3u8Content = m3u8Content.Replace(ykmap.Match(m3u8Content).Value, "#XXX");
            }
        }

        // 针对Disney+字幕修正
        if (m3u8Content.Contains("#EXT-X-DISCONTINUITY") && m3u8Content.Contains("seg_00000.vtt") && m3u8Url.Contains("media.dssott.com/"))
        {
            Regex ykmap = DNSPSubRegex();
            if (ykmap.IsMatch(m3u8Content))
            {
                m3u8Content = m3u8Content.Replace(ykmap.Match(m3u8Content).Value, "#XXX");
            }
        }

        // 针对AppleTv修正
        if (m3u8Content.Contains("#EXT-X-DISCONTINUITY") && m3u8Content.Contains("#EXT-X-MAP") && (m3u8Url.Contains(".apple.com/") || ATVRegex().IsMatch(m3u8Content)))
        {
            // 只取加密部分即可
            Regex ykmap = ATVRegex2();
            if (ykmap.IsMatch(m3u8Content))
            {
                m3u8Content = "#EXTM3U\r\n" + ykmap.Match(m3u8Content).Groups[1].Value + "\r\n#EXT-X-ENDLIST";
            }
        }

        // 针对AppleTv字幕修正：上面只对带 MAP 的音视频保留加密正片段。WebVTT 字幕没有 MAP 也不加密，
        // 若保留片头/前情/片尾各段，按不连续序号对齐后字幕只剩片头的空白段，正片对白全部丢失。
        // 正片是时长最长的一段，字幕取同一段，使其与音视频位于同一时间轴。
        if (m3u8Content.Contains("#EXT-X-DISCONTINUITY") && !m3u8Content.Contains("#EXT-X-MAP") && ATVSubRegex().IsMatch(m3u8Content))
        {
            m3u8Content = KeepLongestDiscontinuity(m3u8Content);
        }

        // 修复#EXT-X-KEY与#EXTINF出现次序异常问题
        var regex = OrderFixRegex();
        if (regex.IsMatch(m3u8Content))
        {
            m3u8Content = regex.Replace(m3u8Content, "$3$2$1");
        }

        return m3u8Content;
    }

    private static string KeepLongestDiscontinuity(string m3u8Content)
    {
        var header = new List<string>();
        var sections = new List<(List<string> Lines, double Duration)>();
        List<string>? current = null;
        double duration = 0;
        foreach (var raw in m3u8Content.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (line.StartsWith(HLSTags.ext_x_endlist) || line.StartsWith("#EXTM3U"))
                continue;
            if (line.StartsWith(HLSTags.ext_x_discontinuity) && !line.StartsWith(HLSTags.ext_x_discontinuity_sequence))
            {
                if (current != null)
                    sections.Add((current, duration));
                current = [];
                duration = 0;
                continue;
            }
            if (current == null && !line.StartsWith(HLSTags.extinf))
            {
                header.Add(line);
                continue;
            }
            current ??= [];
            if (line.StartsWith(HLSTags.extinf) && double.TryParse(line[HLSTags.extinf.Length..].TrimStart(':').Split(',')[0],
                    System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var seconds))
                duration += seconds;
            current.Add(line);
        }
        if (current != null)
            sections.Add((current, duration));
        if (sections.Count < 2)
            return m3u8Content;
        var main = sections.MaxBy(section => section.Duration).Lines;
        return string.Join("\r\n", header.Where(line => line.Length > 0).Prepend("#EXTM3U").Concat(main.Where(line => line.Length > 0))
            .Append(HLSTags.ext_x_endlist));
    }
}