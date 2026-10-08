// 魚博士ランクバッジ（design.md 6.4節）。<rank-badge user-id="xxx"></rank-badge> として埋め込む。
// ガチャ演出画面の「タイトル文言は置かない」方針と両立させるため、控えめな小型ピル表示に留める。
import { getUserDoc } from "./firestore-client.js";

const DEFAULT_RANK = "見習い";

class RankBadge extends HTMLElement {
  static get observedAttributes() {
    return ["user-id"];
  }

  connectedCallback() {
    this.style.position = "absolute";
    this.style.top = "max(10px, env(safe-area-inset-top, 10px))";
    this.style.right = "10px";
    this.style.padding = "3px 10px";
    this.style.borderRadius = "999px";
    this.style.background = "rgba(255,255,255,0.12)";
    this.style.color = "#f3f6ff";
    this.style.fontSize = "11px";
    this.style.fontWeight = "bold";
    this.style.zIndex = "10";
    this.style.pointerEvents = "none";
    this.textContent = DEFAULT_RANK;
    this._load();
  }

  attributeChangedCallback() {
    this._load();
  }

  async _load() {
    const userId = this.getAttribute("user-id");
    if (!userId) return;
    try {
      const user = await getUserDoc(userId);
      this.textContent = (user && user.fishDoctorRank) || DEFAULT_RANK;
    } catch (error) {
      console.warn(error);
      this.textContent = DEFAULT_RANK;
    }
  }
}

if (!customElements.get("rank-badge")) {
  customElements.define("rank-badge", RankBadge);
}
