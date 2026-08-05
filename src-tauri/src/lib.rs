use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

// Chamado tanto pelo clique no tray quanto pelo item "Abrir" do menu. `show()` sozinho nao
// desminimiza -- se a janela ficou minimizada (nao apenas escondida), show() e um no-op
// porque o Windows ja considera ela "visivel", so iconificada. Sem o unminimize, o clique
// no tray parecia nao fazer nada (bug visto ao vivo).
fn mostrar_janela(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Abrir cheguei! Alerta", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            mostrar_janela(&window);
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            mostrar_janela(&window);
                        }
                    }
                })
                .build(app)?;

            // Liga o autostart na primeira execucao -- sem isso o plugin fica so
            // registrado/permitido mas nunca ativado de fato, e o app nao sobe
            // sozinho quando o Windows reinicia.
            let autolaunch = app.autolaunch();
            if !autolaunch.is_enabled().unwrap_or(false) {
                let _ = autolaunch.enable();
            }

            // Se o app foi iniciado com --minimized (autostart do Windows), a janela
            // principal ja nasce oculta (ver tauri.conf.json) -- so o tray aparece.
            Ok(())
        })
        .on_window_event(|window, event| {
            // Fechar pelo X so esconde pra bandeja -- o app so encerra de verdade pelo
            // menu "Sair" do tray. Sem isso, fechar a janela mataria o processo e o
            // parceiro deixaria de receber qualquer alerta ate abrir de novo manualmente.
            if let WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
