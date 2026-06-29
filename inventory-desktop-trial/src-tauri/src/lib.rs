use tauri::Manager;
use tauri_plugin_shell::ShellExt;

// Open a URL (label PNG/PDF, etc.) in the user's default browser/app.
// The in-webview `<a download>` / window.open approach does nothing inside
// the Tauri WebView2, so label print/download silently failed on desktop.
// Routing through the OS shell is the reliable cross-platform path.
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
  app.shell().open(url, None).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![open_external])
    .setup(|app| {
      // Resolve paths for the local backend
      let resource_dir = app.path().resource_dir().unwrap_or_default();
      let app_data_dir = app.path().app_data_dir().unwrap_or_default();
      let _ = std::fs::create_dir_all(&app_data_dir);

      let engine_path = resource_dir
        .join("query_engine-windows.dll.node")
        .to_string_lossy()
        .to_string();

      let db_path = format!(
        "file:{}",
        app_data_dir.join("makhzouni.db").to_string_lossy()
      );

      let app_handle = app.handle().clone();

      // Start local backend sidecar in the background (fire-and-forget).
      // The frontend still connects to the remote server by default;
      // this local backend enables true offline mode in a future release.
      tauri::async_runtime::spawn(async move {
        let sidecar_result = app_handle
          .shell()
          .sidecar("server");

        match sidecar_result {
          Ok(cmd) => {
            let spawn_result = cmd
              .env("PORT", "5050")
              .env("NODE_ENV", "production")
              .env("PRISMA_QUERY_ENGINE_LIBRARY", &engine_path)
              .env("DATABASE_URL", &db_path)
              .env("JWT_SECRET", "makhzouni-mahdi-local-secret-2026")
              .env("JWT_EXPIRES_IN", "365d")
              .env("INITIAL_ADMIN_NAME", "مدير النظام")
              .env("INITIAL_ADMIN_USERNAME", "admin")
              .env("INITIAL_ADMIN_PASSWORD", "Password123!")
              .env("BCRYPT_SALT_ROUNDS", "10")
              .env("ENABLE_WHATSAPP", "false")
              .env("API_RATE_LIMIT_PER_MINUTE", "10000")
              .env("LOGIN_RATE_LIMIT_PER_15_MINUTES", "1000")
              .env("ALLOWED_ORIGINS", "http://localhost:1421,tauri://localhost,https://tauri.localhost")
              .spawn();

            match spawn_result {
              Ok((mut rx, _child)) => {
                // Drain stdout/stderr to prevent pipe blocking
                while let Some(_event) = rx.recv().await {}
              }
              Err(e) => eprintln!("[sidecar] Failed to spawn: {}", e),
            }
          }
          Err(e) => eprintln!("[sidecar] Not found: {}", e),
        }
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri app");
}
