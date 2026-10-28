import { useEffect, useMemo, useState } from 'react';

const DEFAULT_SUGGESTED_USERS = ['torvalds', 'gaearon', 'microsoft', 'vercel', 'octocat'];
const RECENT_KEY = 'github-profile-recent-searches';
const TOKEN_KEY = 'github-profile-token';
const THEME_KEY = 'github-profile-theme';

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark');
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [repos, setRepos] = useState([]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [recentSearches, setRecentSearches] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [repoReadme, setRepoReadme] = useState('');
  const [repoReadmeLoading, setRepoReadmeLoading] = useState(false);
  const [sortKey, setSortKey] = useState('stars');
  const [repoSearch, setRepoSearch] = useState('');
  const [languageFilter, setLanguageFilter] = useState('all');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(TOKEN_KEY, token);
  }, [token]);

  useEffect(() => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentSearches));
  }, [recentSearches]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialUser = params.get('user') || 'torvalds';
    setQuery(initialUser);
  }, []);

  useEffect(() => {
    if (!query) return;
    loadProfile(query);
  }, [query]);

  const languageOptions = useMemo(() => {
    const values = new Set();
    repos.forEach((repo) => {
      if (repo.language) values.add(repo.language);
    });
    return ['all', ...Array.from(values)];
  }, [repos]);

  const filteredRepos = useMemo(() => {
    const lower = repoSearch.trim().toLowerCase();
    return [...repos]
      .filter((repo) => {
        const matchesText = !lower || repo.name.toLowerCase().includes(lower) || repo.description?.toLowerCase().includes(lower);
        const matchesLanguage = languageFilter === 'all' || repo.language === languageFilter;
        return matchesText && matchesLanguage;
      })
      .sort((a, b) => {
        if (sortKey === 'updated') return new Date(b.updated_at) - new Date(a.updated_at);
        if (sortKey === 'name') return a.name.localeCompare(b.name);
        return b.stargazers_count - a.stargazers_count;
      });
  }, [repos, repoSearch, languageFilter, sortKey]);

  const stats = useMemo(() => {
    if (!repos.length) {
      return { stars: 0, forks: 0, watchers: 0, issues: 0, languages: {} };
    }

    const sum = repos.reduce(
      (acc, repo) => {
        acc.stars += repo.stargazers_count || 0;
        acc.forks += repo.forks_count || 0;
        acc.watchers += repo.watchers_count || 0;
        acc.issues += repo.open_issues_count || 0;

        if (repo.language) {
          acc.languages[repo.language] = (acc.languages[repo.language] || 0) + 1;
        }
        return acc;
      },
      { stars: 0, forks: 0, watchers: 0, issues: 0, languages: {} }
    );

    return sum;
  }, [repos]);

  const contributionGrid = useMemo(() => {
    const cells = [];
    const days = 56;
    const map = new Map();

    events.forEach((event) => {
      const date = new Date(event.created_at).toISOString().slice(0, 10);
      map.set(date, (map.get(date) || 0) + 1);
    });

    for (let i = 0; i < days; i += 1) {
      const date = new Date();
      date.setDate(date.getDate() - (days - i - 1));
      const key = date.toISOString().slice(0, 10);
      const count = map.get(key) || 0;
      cells.push({ key, count });
    }

    return cells;
  }, [events]);

  const updateQuery = (nextQuery) => {
    const clean = nextQuery.trim();
    if (!clean) return;
    setQuery(clean);
    setRecentSearches((prev) => {
      const next = [clean, ...prev.filter((entry) => entry.toLowerCase() !== clean.toLowerCase())].slice(0, 6);
      return next;
    });
    const params = new URLSearchParams(window.location.search);
    params.set('user', clean);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  };

  async function loadProfile(username) {
    setLoading(true);
    setError('');
    setProfile(null);
    setRepos([]);
    setEvents([]);

    try {
      const headers = {
        Accept: 'application/vnd.github+json',
      };
      if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;

      const [userRes, reposRes, eventsRes] = await Promise.all([
        fetch(`https://api.github.com/users/${username}`, { headers }),
        fetch(`https://api.github.com/users/${username}/repos?per_page=100`, { headers }),
        fetch(`https://api.github.com/users/${username}/events/public?per_page=30`, { headers }),
      ]);

      if (userRes.status === 404) {
        setError('User not found');
        setLoading(false);
        return;
      }

      if (userRes.status === 403 || reposRes.status === 403 || eventsRes.status === 403) {
        setError('GitHub API rate limit exceeded. Add a token or wait a bit and try again.');
        setLoading(false);
        return;
      }

      if (!userRes.ok || !reposRes.ok || !eventsRes.ok) {
        const msg = await userRes.text();
        throw new Error(msg || 'Failed to load GitHub profile');
      }

      const userData = await userRes.json();
      const repoData = await reposRes.json();
      const eventData = await eventsRes.json();

      setProfile(userData);
      setRepos(repoData);
      setEvents(eventData);
      setSelectedRepo(null);
      setRepoReadme('');
      setRepoSearch('');
      setLanguageFilter('all');
    } catch (err) {
      setError(err.message || 'Something went wrong while loading the profile.');
    } finally {
      setLoading(false);
    }
  }

  async function openRepoDetails(repo) {
    setSelectedRepo(repo);
    setRepoReadmeLoading(true);
    try {
      const headers = {
        Accept: 'application/vnd.github+json',
      };
      if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;

      const readmeRes = await fetch(`https://api.github.com/repos/${repo.full_name}/readme`, { headers });
      if (!readmeRes.ok) {
        setRepoReadme('No README found for this repository.');
        return;
      }

      const data = await readmeRes.json();
      const content = atob(data.content.replace(/\n/g, ''));
      setRepoReadme(content.slice(0, 8000));
    } catch {
      setRepoReadme('Unable to load README for this repository.');
    } finally {
      setRepoReadmeLoading(false);
    }
  }

  const formatRelativeTime = (iso) => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const minutes = Math.round(diffMs / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    updateQuery(query);
  };

  const profileStatsCards = [
    { label: 'Total stars', value: stats.stars },
    { label: 'Forks', value: stats.forks },
    { label: 'Watchers', value: stats.watchers },
    { label: 'Open issues', value: stats.issues },
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-badge">G</div>
          <div>
            <p className="eyebrow">GitHub explorer</p>
            <h1>Profile Analytics</h1>
          </div>
        </div>

        <div className="toolbar">
          <form className="search-form" onSubmit={handleSearchSubmit}>
            <label className="sr-only" htmlFor="profile-search">Search GitHub user</label>
            <input
              id="profile-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search GitHub username"
              aria-label="Search GitHub username"
            />
            <button type="submit">Search</button>
          </form>

          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            aria-label="Toggle color theme"
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </header>

      <main className="page-content">
        <section className="quick-tries" aria-label="Suggested profiles">
          {DEFAULT_SUGGESTED_USERS.map((user) => (
            <button key={user} type="button" className="quick-pill" onClick={() => updateQuery(user)}>
              {user}
            </button>
          ))}
        </section>

        <section className="token-box">
          <label htmlFor="token-input">Optional GitHub token</label>
          <input
            id="token-input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_... (optional)"
          />
        </section>

        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className="skeleton-grid">
            <div className="profile-skeleton skeleton" />
            <div className="stats-skeleton skeleton" />
            <div className="large-skeleton skeleton" />
            <div className="list-skeleton skeleton" />
          </div>
        ) : profile ? (
          <>
            <section className="profile-header card">
              <img src={profile.avatar_url} alt={`${profile.login} avatar`} className="avatar" />
              <div className="profile-copy">
                <div className="profile-name-row">
                  <h2>{profile.name || profile.login}</h2>
                  <span className="username">@{profile.login}</span>
                </div>

                <p className="bio">{profile.bio || 'No bio provided.'}</p>

                <ul className="meta-list">
                  {profile.company && <li>Company: {profile.company}</li>}
                  {profile.location && <li>Location: {profile.location}</li>}
                  {profile.blog && <li>Blog: <a href={profile.blog.startsWith('http') ? profile.blog : `https://${profile.blog}`}>{profile.blog}</a></li>}
                  {profile.twitter_username && <li>Twitter: @{profile.twitter_username}</li>}
                </ul>

                <div className="mini-stats">
                  <span><strong>{profile.followers}</strong> followers</span>
                  <span><strong>{profile.following}</strong> following</span>
                  <span><strong>{profile.public_repos}</strong> repositories</span>
                  <span><strong>{new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong> joined</span>
                </div>
              </div>
            </section>

            <section className="stats-grid">
              {profileStatsCards.map((item) => (
                <article key={item.label} className="stat-card card">
                  <p>{item.label}</p>
                  <h3>{item.value}</h3>
                </article>
              ))}
            </section>

            <section className="analytics-grid">
              <div className="card">
                <div className="section-title-row">
                  <h3>Language distribution</h3>
                </div>
                <div className="donut-wrap">
                  <div className="donut-chart" style={{ '--segments': JSON.stringify(Object.entries(stats.languages)).length }}>
                    {Object.entries(stats.languages).map(([lang, count], index) => (
                      <span key={lang} style={{ '--index': index, '--value': `${(count / repos.length) * 100}%` }} />
                    ))}
                  </div>
                  <ul className="legend-list">
                    {Object.entries(stats.languages).slice(0, 5).map(([lang, count]) => (
                      <li key={lang}><span className="dot" /> {lang}: {count}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="card">
                <div className="section-title-row">
                  <h3>Top repositories</h3>
                </div>
                <ul className="repo-highlight-list">
                  {[...repos].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 5).map((repo) => (
                    <li key={repo.id}>
                      <div>
                        <strong>{repo.name}</strong>
                        <small>{repo.language || 'Misc'}</small>
                      </div>
                      <span>{repo.stargazers_count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="visual-grid">
              <div className="card">
                <div className="section-title-row">
                  <h3>Commit activity</h3>
                </div>
                <div className="heatmap-grid" aria-label="Contribution heatmap">
                  {contributionGrid.map((cell) => (
                    <span
                      key={cell.key}
                      className={`heat-cell level-${cell.count > 3 ? 4 : cell.count}`}
                      title={`${cell.key}: ${cell.count} events`}
                    />
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="section-title-row">
                  <h3>Repos by stars</h3>
                </div>
                <div className="bar-chart" aria-label="Repos by stars bar chart">
                  {[...repos].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 8).map((repo) => (
                    <div key={repo.id} className="bar-row">
                      <span>{repo.name}</span>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{ width: `${Math.max((repo.stargazers_count / Math.max(...repos.map((item) => item.stargazers_count || 0), 1)) * 100, 10)}%` }}
                        />
                      </div>
                      <strong>{repo.stargazers_count}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="browser card">
              <div className="section-title-row">
                <h3>Repository browser</h3>
                <div className="browser-controls">
                  <input
                    type="search"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Filter repos"
                    aria-label="Filter repos"
                  />
                  <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} aria-label="Sort repositories">
                    <option value="stars">Stars</option>
                    <option value="updated">Updated</option>
                    <option value="name">Name</option>
                  </select>
                  <select value={languageFilter} onChange={(e) => setLanguageFilter(e.target.value)} aria-label="Filter by language">
                    {languageOptions.map((language) => (
                      <option key={language} value={language}>{language === 'all' ? 'All languages' : language}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="repo-grid">
                {filteredRepos.length ? (
                  filteredRepos.map((repo) => (
                    <article key={repo.id} className="repo-card">
                      <div className="repo-card-top">
                        <div>
                          <h4>{repo.name}</h4>
                          <p>{repo.description || 'No description provided.'}</p>
                        </div>
                        <button type="button" onClick={() => openRepoDetails(repo)}>Open</button>
                      </div>

                      <div className="topic-row">
                        {(repo.topics || []).slice(0, 3).map((topic) => (
                          <span key={topic}>{topic}</span>
                        ))}
                      </div>

                      <div className="repo-metrics">
                        <span>⭐ {repo.stargazers_count}</span>
                        <span>🍴 {repo.forks_count}</span>
                        <span>📅 {formatRelativeTime(repo.pushed_at)}</span>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <p>No repositories match the current filter.</p>
                  </div>
                )}
              </div>
            </section>

            <section className="activity card">
              <div className="section-title-row">
                <h3>Recent activity feed</h3>
              </div>
              <ul className="activity-list">
                {events.length ? (
                  events.map((event, index) => (
                    <li key={`${event.id || index}`}>
                      <div className="event-dot" />
                      <div>
                        <p>
                          <strong>{event.type}</strong> · {event.repo?.name || 'Repository'}
                        </p>
                        <small>{formatRelativeTime(event.created_at)}</small>
                        <p>{event.payload?.commits?.[0]?.message || event.payload?.pull_request?.title || event.payload?.issue?.title || 'Activity update'}</p>
                      </div>
                    </li>
                  ))
                ) : (
                  <li className="empty-state">
                    <p>No recent public activity available.</p>
                  </li>
                )}
              </ul>
            </section>
          </>
        ) : null}

        {selectedRepo && (
          <div className="drawer-backdrop" onClick={() => setSelectedRepo(null)}>
            <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Repository details drawer">
              <div className="drawer-header">
                <div>
                  <p className="eyebrow">Repository</p>
                  <h3>{selectedRepo.name}</h3>
                </div>
                <button type="button" onClick={() => setSelectedRepo(null)}>Close</button>
              </div>

              <div className="drawer-meta">
                <span>⭐ {selectedRepo.stargazers_count}</span>
                <span>🍴 {selectedRepo.forks_count}</span>
                <span>{selectedRepo.language || 'Unknown language'}</span>
              </div>

              <div className="readme-box">
                {repoReadmeLoading ? <div className="loading-readme" /> : <pre>{repoReadme || 'No README available.'}</pre>}
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
