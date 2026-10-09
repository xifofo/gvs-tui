#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
mod model;
mod ui;
use blinc_app::prelude::*;
use blinc_app::windowed::WindowedApp;
fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("warn")
        .with_ansi(false)
        .init();
    let mobile = std::env::args().any(|arg| arg == "--mobile-preview");
    WindowedApp::run(
        WindowConfig {
            title: "GVS · Blinc 界面预览".into(),
            width: if mobile { 430 } else { 1320 },
            height: if mobile { 860 } else { 880 },
            min_size: Some((390, 640)),
            center: true,
            ..Default::default()
        },
        ui::build,
    )
}
