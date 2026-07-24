package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/webview/webview_go"
)

const port = 34117

func generateSecret() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func getMachineEnv() map[string]string {
	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		userConfigDir = os.TempDir()
	}
	appDir := filepath.Join(userConfigDir, "zaim")
	os.MkdirAll(appDir, 0700)

	secretsFile := filepath.Join(appDir, "zaim-secrets.json")
	secrets := make(map[string]string)

	data, err := os.ReadFile(secretsFile)
	if err == nil {
		json.Unmarshal(data, &secrets)
	}

	changed := false
	keys := []string{"ZAIM_ENC_KEY", "ZAIM_SESSION_SECRET", "ZAIM_API_KEY"}
	for _, k := range keys {
		if secrets[k] == "" {
			secrets[k] = generateSecret()
			changed = true
		}
	}

	if changed {
		data, _ = json.Marshal(secrets)
		os.WriteFile(secretsFile, data, 0600)
	}

	secrets["ZAIM_DB_PATH"] = filepath.Join(appDir, "zaim.db")
	return secrets
}

func main() {
	// Find the Next.js standalone server relative to the executable
	exePath, _ := os.Executable()
	baseDir := filepath.Dir(exePath)
	
	// Production path: standalone is next to the executable
	standaloneDir := filepath.Join(baseDir, "standalone", "zaim")
	serverJS := filepath.Join(standaloneDir, "server.js")
	
	if _, err := os.Stat(serverJS); os.IsNotExist(err) {
		// Fallback 1: Production without workspace
		standaloneDir = filepath.Join(baseDir, "standalone")
		serverJS = filepath.Join(standaloneDir, "server.js")
		
		if _, err := os.Stat(serverJS); os.IsNotExist(err) {
			// Fallback 2: Local dev mode (running `go run main.go` inside `native`)
			baseDir = filepath.Join(baseDir, "..")
			standaloneDir = filepath.Join(baseDir, ".next", "standalone", "zaim")
			serverJS = filepath.Join(standaloneDir, "server.js")
		}
	}

	// Copy static assets (normally handled by build script)
	staticSrc := filepath.Join(baseDir, ".next", "static")
	staticDst := filepath.Join(standaloneDir, ".next", "static")
	publicSrc := filepath.Join(baseDir, "public")
	publicDst := filepath.Join(standaloneDir, "public")
	
	exec.Command("cp", "-R", staticSrc, filepath.Dir(staticDst)).Run()
	exec.Command("cp", "-R", publicSrc, filepath.Dir(publicDst)).Run()

	envVars := os.Environ()
	machineEnv := getMachineEnv()
	for k, v := range machineEnv {
		envVars = append(envVars, fmt.Sprintf("%s=%s", k, v))
	}
	envVars = append(envVars, fmt.Sprintf("PORT=%d", port))
	envVars = append(envVars, "HOSTNAME=127.0.0.1")
	envVars = append(envVars, "NODE_ENV=production")
	envVars = append(envVars, "ZAIM_LOCAL_HTTP=1")

	// Find Node executable
	nodePath := "node" // default to system node
	bundledNode := filepath.Join(baseDir, "bin", "node")
	if runtime.GOOS == "windows" {
		bundledNode = filepath.Join(baseDir, "bin", "node.exe")
	}
	if _, err := os.Stat(bundledNode); err == nil {
		nodePath = bundledNode
	} else if _, err := os.Stat(filepath.Join(filepath.Dir(baseDir), "bin", "node")); err == nil {
		// Mac .app bundle structure: Zaim.app/Contents/MacOS/Zaim, node might be in Resources/bin/node
		nodePath = filepath.Join(filepath.Dir(baseDir), "Resources", "bin", "node")
	}

	// Start the Node server
	cmd := exec.Command(nodePath, serverJS)
	cmd.Dir = standaloneDir
	cmd.Env = envVars
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	err := cmd.Start()
	if err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}

	// Ensure we kill the server when the UI closes
	defer func() {
		cmd.Process.Kill()
	}()

	// Wait for the server to be ready
	for i := 0; i < 80; i++ {
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/", port))
		if err == nil && resp.StatusCode == 200 {
			resp.Body.Close()
			break
		}
		time.Sleep(250 * time.Millisecond)
	}

	// Create a native webview window
	debug := false
	w := webview.New(debug)
	defer w.Destroy()

	w.SetTitle("Zaim")
	w.SetSize(1320, 860, webview.HintNone)

	// Load the local server
	w.Navigate(fmt.Sprintf("http://127.0.0.1:%d", port))
	
	// Launch the native app!
	w.Run()
}
