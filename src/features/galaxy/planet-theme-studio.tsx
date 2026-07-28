"use client";

import type { CSSProperties } from "react";
import { ImagePlus, Orbit, Sparkles } from "lucide-react";

import type { GalaxyZoneKey, Planet } from "@/shared/types/galaxy";
import { planetThemeOptions, resolvePlanetTheme, type PlanetThemeOption } from "./planet-theme";

const materialOptions = ["柔光釉面", "晶体折光", "胶片颗粒", "纪念石纹"];

const zoneOptions: Array<[GalaxyZoneKey, string]> = [
  ["galaxy", "我的星系"],
  ["memories", "记忆星群"],
  ["resonance", "共鸣星轨"],
  ["memorial", "纪念星域"],
];

export function PlanetThemeStudio({
  coverSaving,
  onPreviewZone,
  onSaveCover,
  onSaveTheme,
  onSelectCover,
  onSelectMaterial,
  onSelectTheme,
  onSelectZone,
  previewCoverUrl,
  selectedCoverFile,
  selectedMaterial,
  selectedPlanet,
  selectedTheme,
  selectedZone,
}: {
  coverSaving: boolean;
  onPreviewZone: () => void;
  onSaveCover: () => void;
  onSaveTheme: () => void;
  onSelectCover: (file: File | null) => void;
  onSelectMaterial: (material: string) => void;
  onSelectTheme: (theme: string) => void;
  onSelectZone: (zone: GalaxyZoneKey) => void;
  previewCoverUrl: string | null;
  selectedCoverFile: File | null;
  selectedMaterial: string;
  selectedPlanet: Planet | null;
  selectedTheme: string;
  selectedZone: GalaxyZoneKey;
}) {
  const activeTheme = resolvePlanetTheme(selectedTheme);
  const hasUnsavedPreview = Boolean(
    selectedPlanet && (previewCoverUrl || selectedPlanet.theme !== selectedTheme),
  );
  const previewStyle = planetPreviewStyle(selectedPlanet?.coverAssetId, previewCoverUrl, activeTheme);

  return (
    <div className="workshop-studio">
      <section className="workshop-theme-library" aria-labelledby="workshop-theme-title">
        <div className="workshop-heading">
          <span className="workshop-kicker"><Sparkles size={14} /> 星球工坊</span>
          <h2 id="workshop-theme-title">让一颗星球长成家人的样子</h2>
          <p>主题先在眼前试穿，确认喜欢再保存。不会改变其他星球，也不会改写已经发生的故事。</p>
        </div>

        <div className="workshop-selection" aria-live="polite">
          <span>正在塑造</span>
          <strong>{selectedPlanet ? selectedPlanet.name : "尚未选择星球"}</strong>
          {selectedPlanet ? (
            <small>
              当前星球主题：{selectedTheme} · {activeTheme.tone} · {selectedPlanet.lifeState === "memorial" ? "纪念星" : "家人星球"}
            </small>
          ) : <small>主题会在选择星球后写入数据库。</small>}
        </div>

        <div aria-label="星球主题" className="theme-swatch-grid">
          {planetThemeOptions.map((theme) => {
            const selected = theme.label === selectedTheme;
            return (
              <button
                aria-pressed={selected}
                className={`theme-swatch-card ${selected ? "selected" : ""}`}
                key={theme.label}
                onClick={() => onSelectTheme(theme.label)}
                style={{
                  "--theme-a": theme.palette[0],
                  "--theme-b": theme.palette[1],
                  "--theme-c": theme.palette[2],
                } as CSSProperties}
                type="button"
              >
                <span className="theme-swatch-orb" aria-hidden="true" />
                <span className="theme-swatch-copy">
                  <strong>{theme.label}</strong>
                  <small>{theme.description}</small>
                </span>
                {selected ? <span className="theme-selected-mark">预览中</span> : null}
              </button>
            );
          })}
        </div>

        <div className="workshop-save-row">
          <div>
            <span>{hasUnsavedPreview ? "预览未保存" : "已与保存主题同步"}</span>
            <small>{hasUnsavedPreview ? "保存后会写入这颗星球的真实设置" : "选择另一种主题即可即时试穿"}</small>
          </div>
          <button className="primary workshop-save-theme" disabled={!selectedPlanet} onClick={onSaveTheme} type="button">
            保存星球主题
          </button>
        </div>
      </section>

      <section className="workshop-orbital-stage" aria-label="星球主题实时预览" data-material={selectedMaterial}>
        <div className="workshop-preview-caption">
          <span><Orbit size={15} /> 实时星球预览</span>
          <p>{selectedPlanet ? "照片会先在星球表面预览；点击保存才会私密上传。" : "从星图靠近一颗家人星球，即可开始主题试穿。"}</p>
        </div>

        <div className="workshop-preview-space">
          <span className="workshop-preview-orbit orbit-one" aria-hidden="true" />
          <span className="workshop-preview-orbit orbit-two" aria-hidden="true" />
          <div
            className={`workshop-planet-preview${selectedPlanet?.coverAssetId || previewCoverUrl ? " has-cover" : ""}`}
            data-testid="workshop-planet-preview"
            data-theme={selectedTheme}
            style={previewStyle}
          >
            <span className="workshop-planet-light" aria-hidden="true" />
            <span className="workshop-planet-shade" aria-hidden="true" />
            <span className="workshop-planet-name">{selectedPlanet?.name ?? "等待一颗星球"}</span>
          </div>
          <span className="workshop-preview-satellite satellite-one" aria-hidden="true" />
          <span className="workshop-preview-satellite satellite-two" aria-hidden="true" />
        </div>

        {selectedPlanet ? (
          <div className="workshop-photo-controls">
            <label className="workshop-upload-trigger" htmlFor="planet-cover-upload">
              <ImagePlus size={18} />
              <span>
                <strong>{selectedCoverFile ? "已贴上新照片" : selectedPlanet.coverAssetId ? "更换星球照片" : "给星球贴一张照片"}</strong>
                <small>{selectedCoverFile ? selectedCoverFile.name : "JPG、PNG、WebP 或 AVIF；仅在保存后上传"}</small>
              </span>
              <input
                accept="image/jpeg,image/png,image/webp,image/avif"
                aria-label="上传星球封面"
                id="planet-cover-upload"
                onChange={(event) => onSelectCover(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>
            <button className="secondary workshop-save-cover" disabled={!selectedCoverFile || coverSaving} onClick={onSaveCover} type="button">
              {coverSaving ? "正在私密保存…" : "保存星球封面"}
            </button>
          </div>
        ) : null}

        <details className="workshop-ambient-controls">
          <summary>环境微调 <span>仅本次浏览</span></summary>
          <div className="workshop-ambient-group">
            <span>星球质感</span>
            <div>
              {materialOptions.map((material) => (
                <button
                  aria-pressed={selectedMaterial === material}
                  className={selectedMaterial === material ? "selected" : ""}
                  key={material}
                  onClick={() => onSelectMaterial(material)}
                  type="button"
                >
                  {material}
                </button>
              ))}
            </div>
          </div>
          <div className="workshop-ambient-group">
            <span>星域光线</span>
            <div>
              {zoneOptions.map(([zone, label]) => (
                <button
                  aria-label={`预览星域：${label}`}
                  aria-pressed={selectedZone === zone}
                  className={selectedZone === zone ? "selected" : ""}
                  key={zone}
                  onClick={() => onSelectZone(zone)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button className="secondary workshop-zone-preview" onClick={onPreviewZone} type="button">预览该星域</button>
        </details>
      </section>
    </div>
  );
}

function planetPreviewStyle(assetId: string | null | undefined, previewUrl: string | null, theme: PlanetThemeOption) {
  const coverUrl = previewUrl ?? (assetId ? `/api/assets/${encodeURIComponent(assetId)}/content` : null);

  return {
    "--planet-cover": coverUrl ? `url("${coverUrl}")` : undefined,
    "--preview-a": theme.palette[0],
    "--preview-b": theme.palette[1],
    "--preview-c": theme.palette[2],
  } as CSSProperties;
}
