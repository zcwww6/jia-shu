"use client";

import { getThemeNebula, themeNebulae, type ThemeNebulaKey } from "./theme-nebula-data";

export type ConfirmedMemorySummary = {
  id: string;
  title: string;
  summary: string;
};

export type ThemeNebulaCuratorProps = {
  selectedTheme: ThemeNebulaKey;
  availableMemories: readonly ConfirmedMemorySummary[];
  selectedMemoryIds: readonly string[];
  onSelectTheme: (theme: ThemeNebulaKey) => void;
  onSourceIdsChange: (ids: string[]) => void;
  onUploadDocument: () => void;
  onStartBinding: () => void;
};

export function ThemeNebulaCurator({
  availableMemories,
  onSelectTheme,
  onSourceIdsChange,
  onStartBinding,
  onUploadDocument,
  selectedMemoryIds,
  selectedTheme,
}: ThemeNebulaCuratorProps) {
  const theme = getThemeNebula(selectedTheme);
  const selectedCount = selectedMemoryIds.length;

  function toggleMemory(memoryId: string) {
    const nextSourceIds = selectedMemoryIds.includes(memoryId)
      ? selectedMemoryIds.filter((id) => id !== memoryId)
      : [...new Set([...selectedMemoryIds, memoryId])];

    onSourceIdsChange(nextSourceIds);
  }

  return (
    <section aria-labelledby="theme-curator-title" className="theme-curator" data-theme={theme.tone}>
      <aside aria-label="选择家庭叙事主题" className="theme-curator-constellation">
        <div className="theme-curator-constellation-head">
          <p>主题星云</p>
          <span>选择一种值得被写下的家庭叙事</span>
        </div>
        <div className="theme-curator-theme-grid">
          {themeNebulae.map((candidate) => {
            const isSelected = selectedTheme === candidate.key;

            return (
              <button
                aria-label={candidate.key}
                aria-pressed={isSelected}
                className={`theme-curator-card theme-curator-card-${candidate.tone}`}
                data-selected={isSelected}
                key={candidate.key}
                onClick={() => onSelectTheme(candidate.key)}
                type="button"
              >
                <span className="theme-curator-card-orb" aria-hidden="true" />
                <span className="theme-curator-card-copy">
                  <strong>{candidate.title}</strong>
                  <small>{candidate.promise}</small>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <article className="theme-curator-panel">
        <span aria-hidden="true" className="theme-curator-orbit" />
        <header className="theme-curator-heading">
          <p>家庭叙事策展台</p>
          <h2 id="theme-curator-title">{theme.title}</h2>
          <p className="theme-curator-promise">{theme.promise}</p>
        </header>

        <div className="theme-curator-brief">
          <section aria-labelledby="theme-curator-source-hints">
            <p className="theme-curator-kicker" id="theme-curator-source-hints">适合从这里开始</p>
            <ul className="theme-curator-hints">
              {theme.sourceHints.map((hint) => <li key={hint}>{hint}</li>)}
            </ul>
          </section>
          <section aria-labelledby="theme-curator-intelligent-note">
            <p className="theme-curator-kicker" id="theme-curator-intelligent-note">智能编排建议</p>
            <p className="theme-curator-intelligent-note">{theme.intelligentNote}</p>
          </section>
        </div>

        <fieldset className="theme-curator-sources">
          <legend>从已确认的记忆里挑选素材</legend>
          <p>每一段素材都由家人确认；装订前仍可继续编辑、调整顺序或移除。</p>
          {availableMemories.length > 0 ? (
            <div className="theme-curator-source-list">
              {availableMemories.map((memory) => {
                const checked = selectedMemoryIds.includes(memory.id);

                return (
                  <label className="theme-curator-source" data-selected={checked} key={memory.id}>
                    <input
                      aria-label={`装订来源：${memory.title}`}
                      checked={checked}
                      onChange={() => toggleMemory(memory.id)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{memory.title}</strong>
                      <small>{memory.summary}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="theme-curator-empty">还没有已确认的记忆。上传一份家庭文档，或先去点亮一段记忆。</p>
          )}
        </fieldset>

        <footer className="theme-curator-actions">
          <div aria-live="polite" className="theme-curator-selection-status">
            {selectedCount > 0 ? `已选 ${selectedCount} 段已确认记忆` : "请选择至少一段已确认记忆"}
          </div>
          <div className="theme-curator-action-buttons">
            <button aria-label="上传一份家庭文档" className="secondary" onClick={onUploadDocument} type="button">
              上传一份家庭文档
            </button>
            <button
              aria-label={`开始装订${theme.key}家书`}
              className="primary"
              disabled={selectedCount === 0}
              onClick={onStartBinding}
              type="button"
            >
              开始装订家书
            </button>
          </div>
        </footer>
      </article>
    </section>
  );
}
