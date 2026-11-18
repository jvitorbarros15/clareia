// Command static serves a folder of published JSON files over loopback: the baseline the API is compared with.
package main

import (
	"log"
	"net"
	"net/http"
	"os"
)

func main() {
	if len(os.Args) != 3 {
		log.Fatal("uso: static <pasta> <porta>")
	}
	ln, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", os.Args[2]))
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(http.Serve(ln, http.FileServer(http.Dir(os.Args[1]))))
}
