package crypto

import "testing"

// Regression: 9–11 char keys used to be fully revealed because the 7-char prefix
// and 4-char suffix slices overlapped.
func TestMaskKeyNeverRevealsWholeKey(t *testing.T) {
	cases := []string{
		"sk-123456",    // 9
		"sk-1234567",   // 10
		"sk-12345678",  // 11
		"sk-123456789", // 12
		"sk-proj-abcdefghijklmnopqrstuvwxyz0123456789", // long
	}
	for _, key := range cases {
		masked := MaskKey(key)
		if masked == key {
			t.Errorf("MaskKey(%q) returned the key verbatim", key)
		}
		// The full secret must never be a substring of the mask.
		if len(key) > 8 && containsFull(masked, key) {
			t.Errorf("MaskKey(%q) = %q leaks the full key", key, masked)
		}
	}
	if MaskKey("short") != "****" {
		t.Errorf("short keys must be fully masked")
	}
}

// containsFull reports whether masked contains the entire key as a contiguous run.
func containsFull(masked, key string) bool {
	for i := 0; i+len(key) <= len(masked); i++ {
		if masked[i:i+len(key)] == key {
			return true
		}
	}
	return false
}
