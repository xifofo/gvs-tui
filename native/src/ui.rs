use crate::model::*;
use blinc_app::prelude::*;
use blinc_app::windowed::WindowedContext;
use blinc_core::{Brush, Gradient, Point, State};
use blinc_icons::{icons, to_svg};
const BG: u32 = 0x101113;
const SURFACE: u32 = 0x1b1d20;
const LINE: u32 = 0x2b2d31;
const MUTED: u32 = 0x909398;
const WHITE: u32 = 0xf4f3ef;
const ACCENT: u32 = 0xff7547;
fn c(hex: u32) -> Color {
    fn linear(v: u32) -> f32 {
        let v = v as f32 / 255.;
        if v <= 0.04045 {
            v / 12.92
        } else {
            ((v + 0.055) / 1.055).powf(2.4)
        }
    }
    Color::rgb(
        linear((hex >> 16) & 255),
        linear((hex >> 8) & 255),
        linear(hex & 255),
    )
}
fn label(value: impl Into<String>, size: f32, color: u32) -> blinc_layout::Text {
    text(value)
        .size(size)
        .color(c(color))
        .font(if cfg!(target_os = "macos") {
            "PingFang SC"
        } else {
            "Microsoft YaHei"
        })
}
fn ico(path: &str, size: f32, color: u32) -> impl ElementBuilder + use<> {
    svg(&to_svg(path, size)).size(size, size).color(c(color))
}
fn asset(name: &str) -> String {
    let local = std::env::current_exe().ok().and_then(|p| {
        p.parent()
            .map(|p| p.join("assets").join(format!("{name}.jpg")))
    });
    local
        .filter(|p| p.exists())
        .unwrap_or_else(|| {
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("assets")
                .join(format!("{name}.jpg"))
        })
        .to_string_lossy()
        .into_owned()
}
fn button(title: &str, glyph: &str, primary: bool, state: &State<AppState>, action: Action) -> Div {
    let state = state.clone();
    div()
        .id(format!("button-{title}-{action:?}"))
        .class(if primary { "primary" } else { "control" })
        .h(42.)
        .w(title
            .chars()
            .map(|c| if c.is_ascii() { 8. } else { 14. })
            .sum::<f32>()
            + 64.)
        .flex_shrink_0()
        .padding_x_px(16.)
        .rounded(10.)
        .bg(c(if primary { ACCENT } else { SURFACE }))
        .flex_row()
        .gap_px(9.)
        .items_center()
        .justify_center()
        .cursor_pointer()
        .child(ico(glyph, 17., if primary { BG } else { WHITE }))
        .child(
            label(title, 14., if primary { BG } else { WHITE })
                .weight(FontWeight::Medium)
                .no_wrap(),
        )
        .on_click(move |_| {
            state.update_rebuild(|mut s| {
                s.apply(action);
                s
            })
        })
}
fn chip(title: &str, selected: bool, state: &State<AppState>, action: Action) -> Div {
    let state = state.clone();
    div()
        .id(format!("chip-{title}-{action:?}"))
        .class("control")
        .h(34.)
        .w(title
            .chars()
            .map(|c| if c.is_ascii() { 7. } else { 12. })
            .sum::<f32>()
            + 28.)
        .flex_shrink_0()
        .padding_x_px(13.)
        .rounded(8.)
        .bg(c(if selected { 0x36302c } else { SURFACE }))
        .border(1., c(if selected { 0x966448 } else { LINE }))
        .items_center()
        .justify_center()
        .cursor_pointer()
        .child(label(title, 12., if selected { 0xffb796 } else { MUTED }).no_wrap())
        .on_click(move |_| {
            state.update_rebuild(|mut s| {
                s.apply(action);
                s
            })
        })
}
pub fn build(ctx: &mut WindowedContext) -> Div {
    if ctx.rebuild_count == 0 {
        ctx.add_css(".control:hover { background: #303236; } .primary:hover { background: #ff946f; } .poster:hover { opacity: 0.88; } .hero-shade { background: linear-gradient(90deg, #101113f5 0%, #101113c0 32%, #10111330 67%, #10111305 100%); } .poster-shade { background: linear-gradient(180deg, #10111300 35%, #101113cc 100%); }");
    }
    let state = ctx.use_state_keyed("gvs-ui", AppState::default);
    let data = state.get();
    let mobile = ctx.width < 850.;
    let sidebar_w = if mobile { 0. } else { 204. };
    let content_w = ctx.width - sidebar_w;
    let bottom_h = if mobile { 66. } else { 0. };
    let mut root = div().w(ctx.width).h(ctx.height).bg(c(BG)).flex_row();
    if !mobile {
        root = root.child(sidebar(&state, ctx.height));
    }
    let padding = if mobile { 20. } else { 32. };
    let inner_w = (content_w - padding * 2.).max(320.);
    let content = match data.page {
        Page::Detail => detail(&state, inner_w, mobile),
        Page::Player => player(&state, inner_w, mobile),
        Page::Settings => settings(inner_w),
        Page::Downloads => empty_page(
            "下载",
            "还没有下载任务",
            "当前是独立界面预览，未连接下载服务。",
            icons::DOWNLOAD,
            inner_w,
        ),
        Page::Saved | Page::Search => library(&state, inner_w, mobile),
        Page::Discover => discover(&state, inner_w, mobile),
    };
    let mut body = div()
        .w(content_w)
        .h(ctx.height)
        .flex_col()
        .child(topbar(ctx, &state, content_w, mobile))
        .child(
            scroll()
                .w(content_w)
                .h((ctx.height - 78. - bottom_h).max(100.))
                .vertical()
                .child(
                    div()
                        .w(content_w)
                        .p_px(padding)
                        .flex_col()
                        .gap_px(24.)
                        .child(content)
                        .child(label("界面预览 · 演示片库，未连接账号与播放源", 11., MUTED)),
                ),
        );
    if mobile {
        body = body.child(bottom_nav(&state, content_w));
    }
    root.child(body)
}
fn sidebar(state: &State<AppState>, height: f32) -> Div {
    let mut column = div()
        .w(204.)
        .h(height)
        .bg(c(0x151618))
        .border_right(1., c(LINE))
        .p_px(18.)
        .flex_col()
        .gap_px(8.);
    column = column
        .child(
            div()
                .h(70.)
                .flex_row()
                .gap_px(12.)
                .items_center()
                .child(
                    div()
                        .w(36.)
                        .h(36.)
                        .rounded(11.)
                        .bg(c(ACCENT))
                        .items_center()
                        .justify_center()
                        .child(ico(icons::PLAY, 19., BG)),
                )
                .child(label("GVS", 27., WHITE).weight(FontWeight::Bold)),
        )
        .child(div().h(24.).child(label("你的私人放映室", 11., MUTED)));
    for (name, glyph, page) in [
        ("发现", icons::COMPASS, Page::Discover),
        ("搜索", icons::SEARCH, Page::Search),
        ("我的收藏", icons::BOOKMARK, Page::Saved),
        ("下载", icons::DOWNLOAD, Page::Downloads),
    ] {
        column = column.child(nav(name, glyph, page, state));
    }
    column
        .child(div().flex_grow())
        .child(
            div()
                .p_px(14.)
                .bg(c(0x202123))
                .rounded(12.)
                .flex_col()
                .gap_px(8.)
                .child(label("随时打开，接着看。", 13., WHITE))
                .child(label("为每一块屏幕而设计", 11., MUTED)),
        )
        .child(div().h(12.))
        .child(nav("设置", icons::SETTINGS, Page::Settings, state))
        .child(
            div()
                .h(22.)
                .items_center()
                .child(label("GVS  /  NATIVE PREVIEW", 9., MUTED)),
        )
}
fn nav(name: &str, glyph: &str, page: Page, state: &State<AppState>) -> Div {
    let selected = state.get().page == page;
    let state = state.clone();
    div()
        .id(format!("nav-{page:?}"))
        .class("control")
        .h(45.)
        .w_full()
        .padding_x_px(13.)
        .rounded(9.)
        .bg(c(if selected { 0x30251f } else { 0x151618 }))
        .flex_row()
        .gap_px(12.)
        .items_center()
        .cursor_pointer()
        .child(ico(glyph, 19., if selected { ACCENT } else { MUTED }))
        .child(label(name, 14., if selected { ACCENT } else { MUTED }))
        .on_click(move |_| {
            state.update_rebuild(|mut s| {
                s.apply(Action::Navigate(page));
                s
            })
        })
}
fn bottom_nav(state: &State<AppState>, width: f32) -> Div {
    let mut row = div()
        .w(width)
        .h(66.)
        .bg(c(0x151618))
        .border_top(1., c(LINE))
        .flex_row()
        .justify_around()
        .items_center();
    for (name, glyph, page) in [
        ("发现", icons::COMPASS, Page::Discover),
        ("搜索", icons::SEARCH, Page::Search),
        ("收藏", icons::BOOKMARK, Page::Saved),
        ("设置", icons::SETTINGS, Page::Settings),
    ] {
        let st = state.clone();
        let col = if st.get().page == page { ACCENT } else { MUTED };
        row = row.child(
            div()
                .id(format!("mobile-nav-{page:?}"))
                .w(70.)
                .h(54.)
                .flex_col()
                .gap_px(5.)
                .items_center()
                .justify_center()
                .cursor_pointer()
                .child(ico(glyph, 19., col))
                .child(label(name, 10., col))
                .on_click(move |_| {
                    st.update_rebuild(|mut s| {
                        s.page = page;
                        s
                    })
                }),
        );
    }
    row
}
fn topbar(ctx: &mut WindowedContext, state: &State<AppState>, width: f32, mobile: bool) -> Div {
    let field = ctx.use_state_keyed("search-field", || {
        text_input_state_with_placeholder("搜索影片、剧集、纪录片")
    });
    let st = state.clone();
    div()
        .w(width)
        .h(78.)
        .padding_x_px(if mobile { 20. } else { 32. })
        .border_bottom(1., c(LINE))
        .flex_row()
        .gap_px(16.)
        .items_center()
        .child(if mobile {
            label("GVS", 23., ACCENT).weight(FontWeight::Bold)
        } else {
            label("探索好故事 · 演示片库", 13., MUTED)
        })
        .child(div().flex_grow())
        .child(
            div()
                .w(if mobile { 240. } else { 330. })
                .h(39.)
                .flex_shrink_0()
                .child(
                    text_input(&field.get())
                        .id("global-search")
                        .w(if mobile { 240. } else { 330. })
                        .h(39.)
                        .rounded(10.)
                        .text_size(13.)
                        .bg_colors(c(SURFACE), c(SURFACE), c(SURFACE))
                        .text_color(c(WHITE))
                        .border_color(c(LINE))
                        .on_change(move |query| {
                            st.update_rebuild(|mut s| {
                                s.query = query.to_string();
                                s.page = Page::Search;
                                s
                            })
                        }),
                ),
        )
}
fn platforms(state: &State<AppState>, width: f32) -> Div {
    let mut row = div().w(width).flex_row().flex_wrap().gap_px(8.);
    for (index, title) in PLATFORMS.iter().enumerate() {
        row = row.child(chip(
            title,
            state.get().platform == index,
            state,
            Action::Platform(index),
        ));
    }
    row
}
fn heading(title: &str, note: &str, width: f32) -> Div {
    div()
        .w(width)
        .flex_row()
        .items_center()
        .justify_between()
        .child(label(title, 21., WHITE).weight(FontWeight::SemiBold))
        .child(label(note, 11., MUTED))
}
fn discover(state: &State<AppState>, width: f32, mobile: bool) -> Div {
    div()
        .w(width)
        .flex_col()
        .gap_px(24.)
        .child(hero(state, 0, width, mobile, false))
        .child(platforms(state, width))
        .child(heading("今晚，看点什么", "精选演示", width))
        .child(posters(state, width, mobile))
        .child(heading("一段旅程，一种心情", "", width))
        .child(
            div()
                .w(width)
                .flex_row()
                .flex_wrap()
                .gap_px(12.)
                .child(collection(
                    "去远方",
                    "山野 / 海岸 / 无人之境",
                    "ocean",
                    2,
                    state,
                    if mobile { width } else { (width - 12.) / 2. },
                ))
                .child(collection(
                    "慢下来",
                    "森林 / 星夜 / 自然之声",
                    "forest",
                    1,
                    state,
                    if mobile { width } else { (width - 12.) / 2. },
                )),
        )
}
fn hero(state: &State<AppState>, index: usize, width: f32, mobile: bool, details: bool) -> Div {
    let film = &FILMS[index];
    let height = if mobile { 360. } else { 324. };
    let mut info = div()
        .absolute()
        .z_index(2)
        .left(if mobile { 22. } else { 32. })
        .bottom(28.)
        .flex_col()
        .gap_px(12.)
        .child(label(
            if details {
                film.genre
            } else {
                "本周精选  /  自然的另一面"
            },
            12.,
            0xd6d8d4,
        ))
        .child(label(film.title, if mobile { 36. } else { 46. }, WHITE).weight(FontWeight::Bold))
        .child(label(film.english, 10., 0xc8cbc6))
        .child(div().h(4.))
        .child(label(film.description[0], 14., 0xd1d4d1))
        .child(label(film.description[1], 12., 0xb9bfbc));
    if !details {
        info = info.child(div().h(6.)).child(
            div()
                .flex_row()
                .gap_px(10.)
                .child(button(
                    "查看影片",
                    icons::PLAY,
                    true,
                    state,
                    Action::Open(index),
                ))
                .child(button(
                    if state.get().saved.contains(&index) {
                        "已收藏"
                    } else {
                        "收藏"
                    },
                    icons::BOOKMARK,
                    false,
                    state,
                    Action::Save(index),
                )),
        );
    }
    div()
        .w(width)
        .h(height)
        .relative()
        .rounded(16.)
        .overflow_clip()
        .child(image(&asset(film.asset)).w(width).h(height).cover())
        .child(
            div()
                .background(Brush::Gradient(Gradient::linear(
                    Point::new(0., 0.),
                    Point::new(width, 0.),
                    c(BG).with_alpha(0.96),
                    c(BG).with_alpha(0.08),
                )))
                .z_index(1)
                .absolute()
                .top(0.)
                .left(0.)
                .w(width)
                .h(height),
        )
        .child(info)
}
fn posters(state: &State<AppState>, width: f32, mobile: bool) -> Div {
    let films = state.get().visible();
    if films.is_empty() {
        return empty_page(
            "",
            "没有找到影片",
            "试试其他关键词，或切换到全部平台。",
            icons::SEARCH,
            width,
        );
    }
    let count = if mobile {
        2.
    } else if width < 850. {
        4.
    } else {
        5.
    };
    let card_w = (width - (count - 1.) * 16.) / count;
    let mut row = div().w(width).flex_row().flex_wrap().gap_px(16.);
    for index in films {
        let film = &FILMS[index];
        let st = state.clone();
        let height = card_w * 1.27;
        row =
            row.child(
                div()
                    .id(format!("poster-{index}"))
                    .w(card_w)
                    .flex_col()
                    .gap_px(8.)
                    .cursor_pointer()
                    .class("poster")
                    .child(
                        div()
                            .w(card_w)
                            .h(height)
                            .rounded(10.)
                            .overflow_clip()
                            .relative()
                            .child(image(&asset(film.asset)).w(card_w).h(height).cover())
                            .child(
                                div()
                                    .background(Brush::Gradient(Gradient::linear(
                                        Point::new(0., 0.),
                                        Point::new(0., height),
                                        Color::TRANSPARENT,
                                        c(BG).with_alpha(0.7),
                                    )))
                                    .z_index(1)
                                    .absolute()
                                    .top(0.)
                                    .left(0.)
                                    .w(card_w)
                                    .h(height),
                            )
                            .child(
                                div().absolute().z_index(2).left(14.).bottom(16.).child(
                                    label(film.title, 19., WHITE).weight(FontWeight::SemiBold),
                                ),
                            ),
                    )
                    .child(label(film.title, 14., WHITE))
                    .child(label(
                        format!("{} · {}集", film.genre, film.episodes),
                        10.,
                        MUTED,
                    ))
                    .on_click(move |_| {
                        st.update_rebuild(|mut s| {
                            s.apply(Action::Open(index));
                            s
                        })
                    }),
            );
    }
    row
}
fn collection(
    title: &str,
    description: &str,
    art: &str,
    index: usize,
    state: &State<AppState>,
    width: f32,
) -> Div {
    let st = state.clone();
    div()
        .id(format!("collection-{index}"))
        .w(width)
        .h(116.)
        .rounded(12.)
        .overflow_clip()
        .relative()
        .class("poster")
        .cursor_pointer()
        .child(image(&asset(art)).w(width).h(116.).cover())
        .child(
            div()
                .background(Brush::Gradient(Gradient::linear(
                    Point::new(0., 0.),
                    Point::new(width, 0.),
                    c(BG).with_alpha(0.96),
                    c(BG).with_alpha(0.08),
                )))
                .z_index(1)
                .absolute()
                .top(0.)
                .left(0.)
                .w(width)
                .h(116.),
        )
        .child(
            div()
                .absolute()
                .z_index(2)
                .left(20.)
                .top(26.)
                .flex_col()
                .gap_px(10.)
                .child(label(title, 22., WHITE).weight(FontWeight::SemiBold))
                .child(label(description, 11., 0xc5c9c8)),
        )
        .on_click(move |_| {
            st.update_rebuild(|mut s| {
                s.apply(Action::Open(index));
                s
            })
        })
}
fn library(state: &State<AppState>, width: f32, mobile: bool) -> Div {
    let data = state.get();
    let title = if data.page == Page::Saved {
        "我的收藏"
    } else {
        "搜索影片"
    };
    let mut out = div()
        .w(width)
        .flex_col()
        .gap_px(24.)
        .child(heading(title, "演示片库", width))
        .child(platforms(state, width));
    if data.page == Page::Saved && data.saved.is_empty() {
        out = out.child(empty_page(
            "",
            "把喜欢的故事留在这里",
            "打开影片详情，点击收藏。",
            icons::BOOKMARK,
            width,
        ));
    } else {
        out = out.child(posters(state, width, mobile));
    }
    out
}
fn detail(state: &State<AppState>, width: f32, mobile: bool) -> Div {
    let s = state.get();
    let film = &FILMS[s.selected];
    let mut episodes = div().w(width).flex_row().flex_wrap().gap_px(10.);
    for i in 0..film.episodes {
        episodes = episodes.child(chip(
            &format!("第 {:02} 集", i + 1),
            s.episode == i,
            state,
            Action::Episode(i),
        ));
    }
    div()
        .w(width)
        .flex_col()
        .gap_px(22.)
        .child(div().flex_row().child(button(
            "返回发现",
            icons::ARROW_LEFT,
            false,
            state,
            Action::Navigate(Page::Discover),
        )))
        .child(hero(state, s.selected, width, mobile, true))
        .child(
            div()
                .flex_row()
                .flex_wrap()
                .gap_px(10.)
                .child(button(
                    "预览播放界面",
                    icons::PLAY,
                    true,
                    state,
                    Action::Preview,
                ))
                .child(button(
                    if s.saved.contains(&s.selected) {
                        "已收藏"
                    } else {
                        "加入收藏"
                    },
                    icons::BOOKMARK,
                    false,
                    state,
                    Action::Save(s.selected),
                )),
        )
        .child(label(
            format!(
                "{}  ·  {}  ·  共 {} 集",
                PLATFORMS[film.platform], film.genre, film.episodes
            ),
            12.,
            MUTED,
        ))
        .child(heading("选集", "", width))
        .child(episodes)
        .child(heading("播放偏好", "预览选项", width))
        .child(preferences(state, width))
}
fn preferences(state: &State<AppState>, width: f32) -> Div {
    let s = state.get();
    let mut qualities = div().w(width).flex_row().flex_wrap().gap_px(8.);
    for (i, v) in ["自动画质", "优先 4K", "优先 HDR"].iter().enumerate() {
        qualities = qualities.child(chip(v, s.quality == i, state, Action::Quality(i)));
    }
    let mut subtitles = div().w(width).flex_row().flex_wrap().gap_px(8.);
    for (i, v) in ["简体中文", "English", "关闭字幕"].iter().enumerate() {
        subtitles = subtitles.child(chip(v, s.subtitle == i, state, Action::Subtitle(i)));
    }
    div()
        .w(width)
        .flex_col()
        .gap_px(12.)
        .child(qualities)
        .child(label("字幕", 12., MUTED))
        .child(subtitles)
}
fn player(state: &State<AppState>, width: f32, mobile: bool) -> Div {
    let s = state.get();
    let film = &FILMS[s.selected];
    let height = if mobile { width * 0.62 } else { width * 0.5 };
    div()
        .w(width)
        .flex_col()
        .gap_px(20.)
        .child(
            div()
                .w(width)
                .flex_row()
                .items_center()
                .justify_between()
                .child(button(
                    "返回详情",
                    icons::ARROW_LEFT,
                    false,
                    state,
                    Action::Navigate(Page::Detail),
                ))
                .child(label(
                    format!("{} · 第 {} 集", film.title, s.episode + 1),
                    13.,
                    WHITE,
                )),
        )
        .child(
            div()
                .w(width)
                .h(height)
                .rounded(14.)
                .overflow_clip()
                .relative()
                .bg(c(0x050607))
                .child(image(&asset(film.asset)).w(width).h(height).cover())
                .child(
                    div()
                        .absolute()
                        .top(0.)
                        .left(0.)
                        .w(width)
                        .h(height)
                        .bg(Color::rgba(0., 0., 0., 0.4))
                        .items_center()
                        .justify_center()
                        .flex_col()
                        .gap_px(16.)
                        .child(ico(icons::MONITOR_PLAY, 42., WHITE))
                        .child(label(
                            "原生播放画面区域",
                            if mobile { 18. } else { 24. },
                            WHITE,
                        ))
                        .child(label("静态预览 · 尚未接入播放器", 12., 0xc1c6c7)),
                ),
        )
        .child(heading("播放设置", "", width))
        .child(preferences(state, width))
        .child(
            div()
                .w(width)
                .p_px(18.)
                .rounded(12.)
                .bg(c(SURFACE))
                .flex_col()
                .gap_px(10.)
                .child(label("HDR 状态：待接入与实机验证", 14., 0xffb796))
                .child(label("画质偏好会保留在本次预览中。", 12., MUTED))
                .child(label(
                    "实际输出取决于片源、播放内核与显示设备。",
                    12.,
                    MUTED,
                )),
        )
}
fn empty_page(title: &str, heading: &str, note: &str, glyph: &str, width: f32) -> Div {
    div()
        .w(width)
        .flex_col()
        .gap_px(24.)
        .child(label(title, 26., WHITE).weight(FontWeight::SemiBold))
        .child(
            div()
                .w(width)
                .h(280.)
                .flex_col()
                .gap_px(18.)
                .items_center()
                .justify_center()
                .child(ico(glyph, 36., MUTED))
                .child(label(heading, 20., WHITE))
                .child(label(note, 12., MUTED)),
        )
}
fn settings(width: f32) -> Div {
    let mut out = div()
        .w(width)
        .flex_col()
        .gap_px(22.)
        .child(heading("设置", "", width));
    for (title, value, note) in [
        ("外观", "影院深色", "窗口缩窄后切换为手机布局"),
        ("片库与账号", "演示模式", "当前原型不会读取现有账号或配置"),
        ("播放内核", "尚未接入", "下一阶段对接原生视频输出与字幕"),
        (
            "HDR / 杜比视界",
            "尚未验证",
            "不会仅根据片源标签显示为 HDR 已开启",
        ),
        (
            "关于 GVS",
            "Blinc 原生界面预览",
            "Rust + wgpu · Windows 已构建版本",
        ),
    ] {
        out = out.child(
            div()
                .w(width)
                .p_px(18.)
                .rounded(12.)
                .bg(c(SURFACE))
                .flex_col()
                .gap_px(10.)
                .child(label(title, 15., WHITE).weight(FontWeight::SemiBold))
                .child(label(value, 13., 0xffb796))
                .child(label(note, 11., MUTED)),
        );
    }
    out
}
