package iqcn

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
)

//go:embed sample_tables.bin
var sampleTables []byte

const sampleTableSHA = "499728a0202ab638650a2704444a898b17f056279b3ad9952367e8ffc5a87321"

var sampleCRC = func() (table [256]uint16) {
	for i := range table {
		value := uint16(i) << 8
		for j := 0; j < 8; j++ {
			if value&0x8000 != 0 {
				value = value<<1 ^ 0x1021
			} else {
				value <<= 1
			}
		}
		table[i] = value
	}
	return
}()

func sampleCRC16(data []byte) uint16 {
	crc := uint16(0xffff)
	for _, b := range data {
		crc = sampleCRC[byte(crc>>8)^b] ^ crc<<8
	}
	return crc
}

func checkSampleCRC(data []byte) ([]byte, error) {
	if len(data) < 2 || sampleCRC16(data[:len(data)-2]) != binary.LittleEndian.Uint16(data[len(data)-2:]) {
		return nil, fmt.Errorf("C integrity check failed")
	}
	return data[:len(data)-2], nil
}

var sampleMultiply = func() (table [8][256]byte) {
	coefficients := [8]byte{1, 3, 4, 5, 6, 8, 11, 7}
	for row, coefficient := range coefficients {
		for value := 0; value < 256; value++ {
			a, b, result := byte(value), coefficient, byte(0)
			for bit := 0; bit < 8; bit++ {
				if b&1 != 0 {
					result ^= a
				}
				high := a & 0x80
				a <<= 1
				if high != 0 {
					a ^= 0x1b
				}
				b >>= 1
			}
			table[row][value] = result
		}
	}
	return
}()

func incrementSampleCounter(counter *[16]byte) {
	for i := 15; i >= 0; i-- {
		counter[i]++
		if counter[i] != 0 {
			break
		}
	}
}

func identitySampleBlock(counter [16]byte) [16]byte {
	state := counter
	table := sampleTables[32:]
	for round := 0; round < 10; round++ {
		for pair := 0; pair < 8; pair++ {
			offset := 2 * pair
			index := int(state[offset]) | int(state[offset+1])<<8
			state[offset], state[offset+1] = table[2*index], table[2*index+1]
		}
		before := state
		for _, start := range []int{0, 8} {
			for row := 0; row < 8; row++ {
				value := byte(0)
				for column := 0; column < 8; column++ {
					value ^= sampleMultiply[row^column][before[start+column]]
				}
				state[start+row] = value
			}
		}
		for pair := 0; pair < 8; pair++ {
			state[2*pair] ^= byte(round*8 + pair + 1)
		}
	}
	return state
}

func decodeSampleIdentity(identity string) ([]byte, error) {
	sum := sha256.Sum256(sampleTables)
	if len(sampleTables) != 131104 || hex.EncodeToString(sum[:]) != sampleTableSHA {
		return nil, fmt.Errorf("algorithm table integrity check failed")
	}
	if len(identity) > 1<<20 {
		return nil, fmt.Errorf("C exceeds size limit")
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(strings.TrimSpace(identity))
	if err != nil {
		return nil, fmt.Errorf("invalid C encoding")
	}
	raw, err = checkSampleCRC(raw)
	if err != nil {
		return nil, err
	}
	var counter [16]byte
	copy(counter[:12], sampleTables[:12])
	decoded := make([]byte, len(raw))
	for offset := 0; offset < len(raw); offset += 16 {
		incrementSampleCounter(&counter)
		stream := identitySampleBlock(counter)
		for j := 0; j < 16 && offset+j < len(raw); j++ {
			decoded[offset+j] = raw[offset+j] ^ stream[j]
		}
	}
	return checkSampleCRC(decoded)
}

type sampleTicketRecord struct {
	tag   byte
	value []byte
}

func parseSampleTicket(ticket string) ([]sampleTicketRecord, error) {
	if len(ticket) > 1<<20 {
		return nil, fmt.Errorf("T exceeds size limit")
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(strings.TrimSpace(ticket))
	if err != nil {
		return nil, fmt.Errorf("invalid T encoding")
	}
	var rows []sampleTicketRecord
	for position := 0; position < len(raw); {
		if len(raw)-position < 4 {
			return nil, fmt.Errorf("truncated T record")
		}
		n := int(binary.BigEndian.Uint16(raw[position+2 : position+4]))
		end := position + 4 + n
		if end > len(raw) {
			return nil, fmt.Errorf("invalid T record length")
		}
		value := raw[position+4 : end]
		tag := raw[position]
		if tag == 255 {
			if end != len(raw) || len(value) < 4 {
				return nil, fmt.Errorf("invalid T digest record")
			}
			count := int(value[1])
			if count+4 > len(value) {
				return nil, fmt.Errorf("invalid T digest offset")
			}
			size := int(binary.BigEndian.Uint16(value[count+2 : count+4]))
			sum := sha256.Sum256(raw[:position])
			if size != 32 || count+4+size > len(value) || !bytes.Equal(sum[:], value[count+4:count+4+size]) {
				return nil, fmt.Errorf("T integrity check failed")
			}
		}
		rows = append(rows, sampleTicketRecord{tag, value})
		position = end
	}
	if len(rows) == 0 || rows[len(rows)-1].tag != 255 {
		return nil, fmt.Errorf("missing T digest")
	}
	return rows, nil
}

func sampleContentID(rows []sampleTicketRecord) (string, error) {
	for _, row := range rows {
		if row.tag != 1 {
			continue
		}
		if len(row.value) == 0 || row.value[0] == 0 || int(row.value[0])+1 > len(row.value) {
			return "", fmt.Errorf("invalid T content field")
		}
		sum := sha256.Sum256(row.value[1 : 1+int(row.value[0])])
		return hex.EncodeToString(sum[:3]), nil
	}
	return "", fmt.Errorf("missing T content field")
}

// DeriveSampleParameter computes K from supplied T/C and immutable embedded tables.
// It neither imports a target module nor consults a parameter cache.
func DeriveSampleParameter(ticket, identity string) ([16]byte, error) {
	var key [16]byte
	rows, err := parseSampleTicket(ticket)
	if err != nil {
		return key, err
	}
	if rows[0].tag != 0 || len(rows[0].value) == 0 || rows[0].value[0] != 5 {
		return key, fmt.Errorf("unsupported T family")
	}
	decoded, err := decodeSampleIdentity(identity)
	if err != nil {
		return key, err
	}
	if len(decoded) < 4 {
		return key, fmt.Errorf("truncated C")
	}
	var parameters []byte
	for position := 4; position < len(decoded); {
		if len(decoded)-position < 5 {
			return key, fmt.Errorf("truncated C record")
		}
		size := int64(binary.LittleEndian.Uint32(decoded[position+1:position+5])) - 4
		if size < 0 || size > int64(len(decoded)-position-5) {
			return key, fmt.Errorf("invalid C record length")
		}
		end := position + 5 + int(size)
		if decoded[position] == 2 {
			parameters = decoded[position+5 : end]
		}
		position = end
	}
	if len(parameters) < 4 || binary.LittleEndian.Uint32(parameters[:4])%3 != 0 {
		return key, fmt.Errorf("unsupported C integer state")
	}
	var numbers [4]*big.Int
	var widths [4]int
	position := 4
	for i := range numbers {
		if len(parameters)-position < 4 {
			return key, fmt.Errorf("truncated C integer")
		}
		size := int64(binary.LittleEndian.Uint32(parameters[position : position+4]))
		if size <= 0 || size > int64(len(parameters)-position-4) {
			return key, fmt.Errorf("invalid C integer length")
		}
		widths[i] = int(size)
		numbers[i] = new(big.Int).SetBytes(parameters[position+4 : position+4+int(size)])
		position += 4 + int(size)
		if numbers[i].Sign() == 0 {
			return key, fmt.Errorf("invalid C integer parameters")
		}
	}
	if position != len(parameters) || numbers[0].Bit(0) == 0 {
		return key, fmt.Errorf("invalid C integer trailer or modulus")
	}
	var wrapped, encrypted []byte
	for _, row := range rows {
		if row.tag != 3 {
			continue
		}
		if len(row.value) < 4 {
			return key, fmt.Errorf("truncated T transform")
		}
		size := int(binary.BigEndian.Uint16(row.value[1:3]))
		if size+4 > len(row.value) {
			return key, fmt.Errorf("invalid T transform length")
		}
		switch row.value[size+3] {
		case 2:
			if row.value[0] != 64 {
				return key, fmt.Errorf("unsupported T integer method")
			}
			wrapped = row.value[3 : 3+size]
		case 1:
			if row.value[0] != 1 {
				return key, fmt.Errorf("unsupported T block method")
			}
			encrypted = row.value[3 : 3+size]
		}
	}
	if len(wrapped) != widths[0] || len(encrypted) != 48 {
		return key, fmt.Errorf("unsupported T transform sizes")
	}
	value := new(big.Int).SetBytes(wrapped)
	if value.Cmp(numbers[0]) >= 0 {
		return key, fmt.Errorf("T does not match C")
	}
	exponent := new(big.Int).Add(numbers[1], numbers[2])
	exponent.Mul(exponent, numbers[3])
	block := new(big.Int).Exp(value, exponent, numbers[0]).FillBytes(make([]byte, widths[0]))
	if len(block) < 11 {
		return key, fmt.Errorf("T/C integer padding check failed")
	}
	separator := bytes.IndexByte(block[2:], 0) + 2
	if len(block) < 11 || block[0] != 0 || block[1] != 2 || separator < 10 || len(block)-separator-1 != 32 {
		return key, fmt.Errorf("T/C integer padding check failed")
	}
	aesBlock, err := aes.NewCipher(block[separator+1:])
	if err != nil {
		return key, fmt.Errorf("invalid intermediate length")
	}
	plain := make([]byte, len(encrypted))
	cipher.NewCBCDecrypter(aesBlock, sampleTables[16:32]).CryptBlocks(plain, encrypted)
	padding := int(plain[len(plain)-1])
	if padding < 1 || padding > 16 || len(plain)-padding != 32 {
		return key, fmt.Errorf("T/C block padding check failed")
	}
	for _, value := range plain[len(plain)-padding:] {
		if int(value) != padding {
			return key, fmt.Errorf("T/C block padding check failed")
		}
	}
	copy(key[:], plain[:16])
	return key, nil
}
