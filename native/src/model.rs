//! Offline interaction model. No gateway credentials or production state are read.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Page {
    #[default]
    Discover,
    Search,
    Saved,
    Downloads,
    Settings,
    Detail,
    Player,
}
#[derive(Clone, Debug, Default)]
pub struct AppState {
    pub page: Page,
    pub selected: usize,
    pub episode: usize,
    pub platform: usize,
    pub query: String,
    pub saved: Vec<usize>,
    pub quality: usize,
    pub subtitle: usize,
}
#[derive(Clone, Copy, Debug)]
pub enum Action {
    Navigate(Page),
    Open(usize),
    Episode(usize),
    Preview,
    Save(usize),
    Platform(usize),
    Quality(usize),
    Subtitle(usize),
}
impl AppState {
    pub fn apply(&mut self, action: Action) {
        match action {
            Action::Navigate(page) => self.page = page,
            Action::Open(index) => {
                self.selected = index.min(FILMS.len() - 1);
                self.episode = 0;
                self.page = Page::Detail;
            }
            Action::Episode(index) => self.episode = index.min(FILMS[self.selected].episodes - 1),
            Action::Preview => self.page = Page::Player,
            Action::Save(index) => {
                if self.saved.contains(&index) {
                    self.saved.retain(|&i| i != index);
                } else if index < FILMS.len() {
                    self.saved.push(index);
                }
            }
            Action::Platform(index) => self.platform = index.min(PLATFORMS.len() - 1),
            Action::Quality(index) => self.quality = index.min(2),
            Action::Subtitle(index) => self.subtitle = index.min(2),
        }
    }
    pub fn visible(&self) -> Vec<usize> {
        let query = self.query.trim().to_lowercase();
        FILMS
            .iter()
            .enumerate()
            .filter(|(i, f)| {
                (self.page != Page::Saved || self.saved.contains(i))
                    && (self.platform == 0 || f.platform == self.platform)
                    && (self.page != Page::Search
                        || query.is_empty()
                        || format!("{} {} {}", f.title, f.english, f.genre)
                            .to_lowercase()
                            .contains(&query))
            })
            .map(|(i, _)| i)
            .collect()
    }
}
pub const PLATFORMS: &[&str] = &[
    "全部平台",
    "优酷",
    "腾讯视频",
    "红果",
    "Huangguo",
    "meWATCH",
];
pub struct Film {
    pub title: &'static str,
    pub english: &'static str,
    pub genre: &'static str,
    pub asset: &'static str,
    pub description: [&'static str; 2],
    pub episodes: usize,
    pub platform: usize,
}
// Fictional titles and sample source assignments, separate from live catalog data.
pub const FILMS: &[Film] = &[
    Film {
        title: "山海之间",
        english: "BETWEEN EARTH & SKY",
        genre: "自然 · 纪录片",
        asset: "mountains",
        description: ["翻过群山，穿过云海。", "把脚步放慢，让世界的声音重新清晰。"],
        episodes: 8,
        platform: 1,
    },
    Film {
        title: "荒野回声",
        english: "ECHOES OF THE WILD",
        genre: "探索 · 纪录片",
        asset: "forest",
        description: [
            "在森林的深处，寻找久违的安静。",
            "一段关于生命与时间的旅程。",
        ],
        episodes: 6,
        platform: 2,
    },
    Film {
        title: "远岸",
        english: "THE FAR SHORE",
        genre: "旅行 · 电影",
        asset: "ocean",
        description: [
            "海风吹来的地方，总有新的故事。",
            "离开熟悉的岸边，与自己重新相遇。",
        ],
        episodes: 1,
        platform: 4,
    },
    Film {
        title: "沙丘来信",
        english: "LETTERS FROM THE DUNES",
        genre: "人文 · 纪录片",
        asset: "desert",
        description: [
            "沿着风留下的纹路，走向地平线。",
            "沙海里，一封写给远方的信。",
        ],
        episodes: 4,
        platform: 5,
    },
    Film {
        title: "夜航",
        english: "INTO THE NIGHT",
        genre: "剧情 · 短剧",
        asset: "night",
        description: [
            "当城市入睡，星空开始讲述。",
            "那些未说完的话，都留在了夜色里。",
        ],
        episodes: 12,
        platform: 3,
    },
];
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn changing_title_resets_episode_and_bounds_selection() {
        let mut s = AppState::default();
        s.apply(Action::Episode(999));
        assert_eq!(s.episode, 7);
        s.apply(Action::Open(2));
        assert_eq!((s.selected, s.episode, s.page), (2, 0, Page::Detail));
        s.apply(Action::Episode(9));
        assert_eq!(s.episode, 0);
    }
    #[test]
    fn search_and_platform_filters_compose() {
        let mut s = AppState {
            page: Page::Search,
            query: "纪录片".into(),
            ..Default::default()
        };
        assert_eq!(s.visible(), vec![0, 1, 3]);
        s.apply(Action::Platform(2));
        assert_eq!(s.visible(), vec![1]);
        s.query = "NO MATCH".into();
        assert!(s.visible().is_empty());
    }
    #[test]
    fn saved_titles_can_be_added_and_removed() {
        let mut s = AppState {
            page: Page::Saved,
            ..Default::default()
        };
        assert!(s.visible().is_empty());
        s.apply(Action::Save(3));
        assert_eq!(s.visible(), vec![3]);
        s.apply(Action::Save(3));
        assert!(s.visible().is_empty());
    }
}
