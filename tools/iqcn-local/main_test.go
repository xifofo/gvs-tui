package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRejectInvalidRequestWithoutChangingOutput(t *testing.T) {
	dir := t.TempDir()
	source, dest := filepath.Join(dir, "source.ts"), filepath.Join(dir, "output.ts")
	if err := os.WriteFile(source, make([]byte, 188), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dest, []byte("existing"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, req := range []request{
		{Version: 2, Source: source, Destination: dest},
		{Version: 1, Source: source, Destination: source},
		{Version: 1, Source: source, Destination: dest, Ticket: "invalid", Identity: "invalid"},
	} {
		if _, err := process(req); err == nil {
			t.Fatal("invalid request accepted")
		}
	}
	got, err := os.ReadFile(dest)
	if err != nil || string(got) != "existing" {
		t.Fatal("existing output changed")
	}
}

func TestClearCandidateRejectsPartialAndScrambledPackets(t *testing.T) {
	packet := make([]byte, 188)
	packet[0], packet[3] = 0x47, 0x10
	if !clearCandidate(packet) {
		t.Fatal("aligned candidate rejected")
	}
	if clearCandidate(packet[:187]) || clearCandidate(nil) {
		t.Fatal("incomplete candidate accepted")
	}
	packet[3] |= 0x80
	if clearCandidate(packet) {
		t.Fatal("scrambled candidate accepted")
	}
}

// Optional paired sample stays outside the repo; no account material is copied
// into fixtures. The golden digest verifies the migrated local executable.
func TestPairedSampleAndLargeLocalSegment(t *testing.T) {
	dir := os.Getenv("IQCN_SAMPLE_DIR")
	if dir == "" {
		t.Skip("set IQCN_SAMPLE_DIR for paired sample acceptance")
	}
	sample, err := os.ReadFile(filepath.Join(dir, "pairs", "seg.bbts"))
	if err != nil {
		t.Fatal(err)
	}
	ticket, err := os.ReadFile(filepath.Join(dir, "pairs", "ticket_0.b64"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "out", "cert_server.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cert struct {
		Cert string `json:"cert"`
	}
	if err := json.Unmarshal(raw, &cert); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		copies int
		sha    string
	}{
		{1, "c9bbda544cc1525c89ba55fa2b6810bf1f9b32ae06f7f663fd78590ecb2850e1"},
		{8, "29e86699bee81e45f909c5f82096ef984606936dbda331bf684a76fe33abedac"},
	} {
		work := t.TempDir()
		source, dest := filepath.Join(work, "in.ts"), filepath.Join(work, "out.ts")
		if err := os.WriteFile(source, bytes.Repeat(sample, tc.copies), 0600); err != nil {
			t.Fatal(err)
		}
		req := request{Version: 1, Source: source, Destination: dest, Ticket: strings.TrimSpace(string(ticket)), Identity: cert.Cert}
		result, err := process(req)
		if err != nil || !result.Restored || result.Bytes != len(sample)*tc.copies {
			t.Fatalf("local processing failed: %v", err)
		}
		output, err := os.ReadFile(dest)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(output)
		if hex.EncodeToString(sum[:]) != tc.sha {
			t.Fatal("local result differs from validated paired sample")
		}
		if _, err := process(req); err == nil {
			t.Fatal("existing destination overwritten")
		}
	}
}
