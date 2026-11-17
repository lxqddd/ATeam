package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/lxqddd/ATeam/internal/app"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg := app.DefaultConfig()
	instance, err := app.New(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer instance.Close()

	url, err := instance.StartLocal(ctx)
	if err != nil {
		log.Fatal(err)
	}

	wailsApp := application.New(application.Options{
		Name:        "ATeam",
		Description: "Local-first multi-agent development cockpit",
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "ATeam",
		Width:            1440,
		Height:           900,
		URL:              url,
		BackgroundColour: application.NewRGB(9, 9, 11),
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 40,
			TitleBar:                application.MacTitleBarHiddenInset,
			Backdrop:                application.MacBackdropTranslucent,
		},
	})

	if err := wailsApp.Run(); err != nil {
		log.Fatal(err)
	}
}
