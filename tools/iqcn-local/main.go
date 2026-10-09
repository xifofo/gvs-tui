// iqcn-local processes one local file. It has no network transport. Secrets are
// accepted only on stdin, never command-line arguments, logs or temporary files.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	iqcn "gvs/iqcn-local/restore"
)

const maxSegmentBytes = 64 << 20

type request struct {
	Version     int    `json:"version"`
	Ticket      string `json:"ticket"`
	Identity    string `json:"identity"`
	Source      string `json:"source"`
	Destination string `json:"destination"`
}

type result struct {
	Version        int  `json:"version"`
	Bytes          int  `json:"bytes"`
	Restored       bool `json:"restored"`
	ClearCandidate bool `json:"clearCandidate"`
}

func process(req request) (result, error) {
	var result = result{Version: 1}
	if req.Version != 1 || req.Source == "" || req.Destination == "" {
		return result, errors.New("invalid local processing request")
	}
	source, err := filepath.Abs(req.Source)
	if err != nil {
		return result, errors.New("invalid input path")
	}
	dest, err := filepath.Abs(req.Destination)
	if err != nil || source == dest {
		return result, errors.New("invalid output path")
	}
	f, err := os.Open(source)
	if err != nil {
		return result, errors.New("cannot open local segment")
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxSegmentBytes+1))
	if err != nil || len(data) > maxSegmentBytes {
		return result, errors.New("local segment exceeds size limit or cannot be read")
	}
	r, err := iqcn.NewSampleRestorer(req.Ticket, req.Identity)
	if err != nil {
		return result, errors.New("invalid local processing material")
	}
	clear, report, err := r.Restore(context.Background(), data)
	if err != nil {
		if err.Error() != "S has no D on PID 17" || !clearCandidate(data) {
			return result, errors.New("local segment restoration failed")
		}
		clear = data
		result.ClearCandidate = true
	} else {
		if report.Units == 0 || report.Passed != report.Units || len(report.Failures) != 0 {
			return result, errors.New("local segment restoration incomplete")
		}
		result.Restored = true
	}
	out, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return result, errors.New("cannot create local output")
	}
	_, err = out.Write(clear)
	closeErr := out.Close()
	if err != nil || closeErr != nil {
		_ = os.Remove(dest)
		return result, errors.New("cannot write local output")
	}
	result.Bytes = len(clear)
	return result, nil
}

// A candidate still has to pass full-file decode and coverage in the client.
func clearCandidate(data []byte) bool {
	if len(data) == 0 || len(data)%188 != 0 {
		return false
	}
	for i := 0; i < len(data); i += 188 {
		if data[i] != 0x47 || data[i+1]&0x80 != 0 || data[i+3]&0xc0 != 0 {
			return false
		}
	}
	return true
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		fmt.Println("iqcn-local 1")
		return
	}
	var req request
	if err := json.NewDecoder(io.LimitReader(os.Stdin, 3<<20)).Decode(&req); err != nil {
		fmt.Fprintln(os.Stderr, "invalid local processing request")
		os.Exit(1)
	}
	res, err := process(req)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if json.NewEncoder(os.Stdout).Encode(res) != nil {
		os.Exit(1)
	}
}
