use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_shell::init())
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
