// ─────────────────────────────────────────────────────────────────────────────
// UKIYO-E EDO — prompt Veo3 cho truyện cổ Nhật vẽ kiểu tranh khắc gỗ màu nhạt.
//
// Khác tab "Đồng bộ nhân vật" (dùng @Tên + ảnh tham chiếu Flow):
//   • Tranh ukiyo-e nét phẳng nên KHÔNG cần ảnh tham chiếu — khóa nhân vật bằng
//     CHÍNH MÔ TẢ trong prompt (10–20 từ EN), dán NGUYÊN VĂN mọi lần xuất hiện.
//   • Mô tả gồm: tuổi · khuôn mặt (điểm nhấn mặt CHỈ khi nguồn nêu) · tóc (kiểu, màu) ·
//     trang phục (màu, điểm nhấn trang phục nếu nguồn/thân phận có) · vóc dáng.
//   • BIẾN ĐỔI THEO CHẶNG: nghèo→giàu, bé→lớn, giả dân thường→lộ thân phận…
//     Mỗi biến thể gắn mốc "từ dòng SRT số mấy"; CODE chọn biến thể đúng theo
//     cueId của lô rồi mới đưa cho AI — AI không tự đoán.
//   • Nhóm phụ (đám trẻ, gia nhân, dân làng) có mô tả CHUNG; khi tách riêng một
//     người thì dùng mô tả riêng của người đó.
// Quy trình vẫn là SRT → timeline (tái dùng planVeo3Clips/sceneMap của tab Veo3).
// ─────────────────────────────────────────────────────────────────────────────

import type { SubtitleItem } from '../types';
import { callPortChat } from './portGateway';
import { callDirectChat, isDirectApiModel } from './directApiService';
import { callClaudeLocalChat, isClaudeLocalModel } from './claudeLocalService';
import { callClaudeSv2Chat, isClaudeSv2Model } from './claudeSv2Service';
import { throwIfAborted } from '../utils/stopControl';
import { withRetry } from '../utils/retry';
import { lamSachMoTa } from '../utils/promptSanitizer';

// Style mặc định — bản chốt 2026-08-04, vá đủ 4 nhóm lỗi đo thực tế:
//  1. MÁU: bỏ "full bleed" (Veo đọc "bleed" = CHẢY MÁU — 552/552 prompt dính, 2026-07-31).
//  2. DA: "balanced contrast" + khối bảo vệ da (chống "woodblock" áp vân gỗ/vết nứt lên mặt).
//  3. NGƯỜI THẬT: mở đầu bằng "2D hand-drawn animation" thay "Cinematic camera shot";
//     khóa CẢ nhân vật lẫn nền cùng chất vẽ (cũ chỉ khóa background); bỏ "not an artwork"
//     (= mời Veo quay thật); "realistic human proportions" → "natural adult body proportions";
//     thêm khối cấm live-action/photoreal/3D.
//  4. RÁCH RƯỚI: "All clothing intact, modest" — Veo vẽ áo rách là lộ cơ thể nhạy cảm.
// Tab 4 Edo @ dùng chung bản này (EDO_DEFAULT_STYLE tham chiếu thẳng).
export const UKIYOE_DEFAULT_STYLE =
    'Traditional 2D hand-drawn Japanese animation, the entire frame rendered as a moving ukiyo-e woodblock ' +
    'illustration — characters, faces and background all in the same flat painted style. ' +
    'Vivid colors, rich traditional pigments, balanced contrast with soft tonal transitions, ' +
    'crisp thin dark-brown ink outlines, deep indigo, bold crimson red, and golden ochre palette. ' +
    'Painterly atmospheric perspective, delicate ukiyo-e-style faces, natural adult body proportions. ' +
    'Faces and skin rendered smoothly with clean flat color and soft even lighting: perfectly smooth ' +
    'unblemished skin, no cracks, no craquelure, no wood grain, no carving lines or texture on skin, ' +
    'no harsh shadow splitting the face, no blood, no wounds, no scars, no bruises. ' +
    'All clothing intact, modest and fully covering — no torn or revealing garments. ' +
    'The animated scene fills the entire 16:9 frame and extends seamlessly to all four edges. ' +
    'Strictly no live-action footage, no photorealistic rendering, no real human actors, no photography, no 3D CGI. ' +
    'No text, subtitles, watermark, logos, signatures, seals, calligraphy, kanji, borders, frames, margins, ' +
    'paper edges, parchment, scrolls, posters, book pages, picture-in-picture, split panels, or modern objects. ' +
    'Audio: only natural sound effects and ambient sounds. No narration, no voiceover, no dialogue.';

/** Một biến thể ngoại hình của nhân vật, hiệu lực TỪ dòng SRT `tuDong` trở đi. */
export interface UkiyoeVariant {
    /** dòng SRT bắt đầu áp dụng (1 = từ đầu truyện) */
    tuDong: number;
    /** lý do đổi (nghèo→giàu, lớn lên, lộ thân phận…) — để người dùng soát */
    moc: string;
    /** mô tả khóa 10–20 từ tiếng Anh */
    moTa: string;
}

export interface UkiyoeCharacter {
    ten: string;
    vai: string;
    /** true = nhóm người (đám trẻ, gia nhân, dân làng) — mô tả chung */
    laNhom?: boolean;
    /** các chặng ngoại hình, sắp xếp tăng dần theo tuDong (ít nhất 1) */
    bienThe: UkiyoeVariant[];
}

interface ChatResult { text: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }

const callByModel = async (
    model: string, systemText: string, userText: string, signal?: AbortSignal
): Promise<ChatResult> => {
    const opts = { model, systemText, userText, temperature: 0.7, json: true, signal };
    if (isClaudeSv2Model(model)) return callClaudeSv2Chat(opts);
    if (isClaudeLocalModel(model)) return callClaudeLocalChat(opts);
    if (isDirectApiModel(model)) return callDirectChat(opts);
    return callPortChat(opts);
};

const cleanJson = (raw: string): any => {
    let s = raw.trim();
    s = s.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
    return JSON.parse(s.trim());
};

/** Mô tả hiệu lực của nhân vật tại dòng SRT `cueId` (biến thể mới nhất đã tới mốc). */
export const moTaTaiDong = (c: UkiyoeCharacter, cueId: number): string => {
    let out = c.bienThe[0]?.moTa || '';
    for (const v of c.bienThe) if (v.tuDong <= cueId) out = v.moTa;
    return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// PHA 0 — PHÂN TÍCH & KHÓA NHÂN VẬT (1 lượt đọc toàn truyện)
// ─────────────────────────────────────────────────────────────────────────────
export const analyzeUkiyoeCharacters = async (args: {
    items: SubtitleItem[];
    model: string;
    signal?: AbortSignal;
}): Promise<UkiyoeCharacter[]> => {
    const { items, model, signal } = args;
    throwIfAborted(signal);

    // Truyện dài: lấy mẫu đều toàn bộ để thấy cả biến đổi cuối truyện.
    const MAX = 320;
    const step = Math.max(1, Math.ceil(items.length / MAX));
    const sample = items.filter((_, i) => i % step === 0).map(it => `${it.id}. ${it.text}`).join('\n');

    const systemText = `ROLE: Bạn là họa sĩ thiết kế nhân vật cho phim hoạt hình tranh khắc gỗ ukiyo-e Nhật Bản thời Edo.

NHIỆM VỤ: đọc kịch bản (đánh số theo dòng phụ đề) và KHÓA ngoại hình toàn bộ nhân vật, để mọi cảnh vẽ ra trông giống hệt nhau.

════════ CHỌN NHÂN VẬT ════════
- Tổng 8–12 mục. Gồm: nhân vật chính, nhân vật phụ xuất hiện nhiều, nhân vật đơn lẻ nhưng có vai trò rõ.
- NHÓM người xuất hiện cùng nhau (đám con gái nhỏ, gia nhân, dân làng, lính) → 1 mục với "laNhom": true, mô tả CHUNG cả nhóm (số lượng, độ tuổi, kiểu trang phục đồng bộ). SỐ LƯỢNG nhóm PHẢI lấy đúng con số truyện nêu (truyện nói "bảy góa phụ" thì mô tả là "group of 7 widows", CẤM tự đổi thành 3 hay "a few") — đọc kỹ toàn bộ kịch bản để tìm con số này.
- Nếu một người trong nhóm về sau tách ra có vai trò riêng → THÊM mục riêng cho người đó.
- Bỏ qua người chỉ thoáng qua 1 câu không ảnh hưởng truyện.

════════ MÔ TẢ KHÓA (quan trọng nhất) ════════
Mỗi mô tả là MỘT CỤM TIẾNG ANH 10–20 TỪ, không chấm câu thừa, đủ các chốt theo thứ tự:
tuổi · khuôn mặt (điểm nhấn mặt CHỈ khi kịch bản nêu) · kiểu tóc + màu tóc · màu trang phục + điểm nhấn trang phục (nếu nguồn/thân phận có) · vóc dáng
Ví dụ đạt (kịch bản không nêu mark): "9-year-old girl, round face, short black bob, moss-green kimono with orange sash, small slight build"
Ví dụ đạt (kịch bản không nêu mark): "late-50s woman, calm oval face with soft laugh lines, grey-streaked bun with tortoiseshell comb, faded indigo kimono, thin stooped frame"
Ví dụ đạt CHỈ khi nguồn nêu: source says a mole on the right cheek → "late-50s woman, oval face with a small mole on the right cheek, grey-streaked bun, faded indigo kimono, thin stooped frame"
- Điểm nhấn mặt (nốt ruồi, lúm, sẹo, vết bớt…) CHỈ khi kịch bản gốc nêu rõ — đúng người, đúng vị trí, đúng mô tả. Không nêu thì mặt sạch: chỉ dáng mặt, mắt, mày, mũi, miệng. CẤM bịa mole / beauty mark / dimple / birthmark. CẤM "mỗi nhân vật một điểm nhấn khác nhau".
- Tóc/trâm/lược/hoa tai: được dùng nếu phù hợp thân phận hoặc kịch bản nêu — không ép mỗi người một mark bịa.
- CẤM TUYỆT ĐỐI bịa điểm nhấn thương tích (Veo vẽ thành vết thương/mặt nứt vỡ — lỗi thật 2026-07-31): sẹo (scar), vết rạch, vết bầm, vết bỏng, da nứt nẻ (cracked/weathered/chapped skin), mặt hốc hác dữ tợn (gaunt/haggard), mắt vằn máu (bloodshot). Truyện thật sự mô tả sẹo thì mới được ghi, đúng như nguồn.
- CẤM mọi từ gợi thương tích BỊA trong mô tả: scar, wound, blood, bloodshot, bruise, crack, cut, burn, weathered, gaunt, hollow, frail.
- CẤM viết tên nhân vật trong mô tả. CẤM nhắc phong cách tranh (đã có ở hậu tố chung).

════════ NHÂN VẬT NGHÈO / KHỔ — TRANG PHỤC AN TOÀN (bắt buộc) ════════
- Nghèo khổ thể hiện bằng: vải bông/gai mộc màu bạc phai (faded, plain, coarse), áo vá GỌN GÀNG (neatly patched), tay áo sờn nhẹ, tóc buộc đơn giản.
- TUYỆT ĐỐI KHÔNG dùng ragged, tattered, torn, threadbare, rags, half-naked, revealing — Veo vẽ áo rách là LỘ CƠ THỂ NHẠY CẢM, video hỏng.
- Nhân vật NỮ dù nghèo, ăn xin hay tù tội vẫn phải XINH ĐẸP ưa nhìn: gương mặt thanh tú, nét đẹp dịu dàng; quần áo nghèo nhưng NGUYÊN VẸN và KÍN ĐÁO. Nỗi khổ lộ qua ánh mắt mệt mỏi, dáng lưng, cử chỉ — không qua rách rưới hay thân hình tiều tụy.

════════ BIẾN ĐỔI THEO CHẶNG (bắt buộc kiểm tra) ════════
Nếu nhân vật thay đổi ngoại hình theo diễn biến — nghèo→giàu, giàu→sa sút, trẻ con→lớn, ốm→khỏe, dân thường→lộ thân phận quan/quý tộc, tóc đen→bạc, thường phục→tang phục — thì tạo THÊM biến thể:
- "tuDong": SỐ DÒNG PHỤ ĐỀ mà từ đó ngoại hình mới bắt đầu (đọc kỹ để lấy đúng mốc).
- "moc": lý do đổi, tiếng Việt ngắn (vd "sau khi rời nhà, mặc áo vá"; "20 năm sau, tóc bạc").
- "moTa": mô tả mới, vẫn 10–20 từ, GIỮ NGUYÊN nét mặt đã khóa (kể cả mark nếu mô tả gốc có vì nguồn nêu). Không thêm mole/mark mới. Nếu mô tả gốc không có mark thì biến thể cũng không được thêm. Tóc/trâm giữ nếu nguồn hoặc thân phận vẫn đúng.
Biến thể đầu tiên luôn có "tuDong": 1. Nhân vật không đổi thì chỉ 1 biến thể.

OUTPUT CHỈ JSON, không lời dẫn:
{"characters":[{"ten":"Tên (tiếng Việt/Nhật)","vai":"vai trò ngắn","laNhom":false,"bienThe":[{"tuDong":1,"moc":"ban đầu","moTa":"..."}]}]}
JSON SAFETY: TUYỆT ĐỐI không dùng dấu nháy kép (") bên trong giá trị chuỗi.`;

    const res = await withRetry(
        () => callByModel(model, systemText, sample, signal),
        3, undefined, signal
    );
    const data = cleanJson(res.text);
    const list: UkiyoeCharacter[] = (Array.isArray(data?.characters) ? data.characters : [])
        .map((c: any) => ({
            ten: String(c.ten || '').trim() || 'Nhân vật',
            vai: String(c.vai || '').trim(),
            laNhom: !!c.laNhom,
            bienThe: (Array.isArray(c.bienThe) ? c.bienThe : [])
                .map((v: any) => ({
                    tuDong: Math.max(1, Number(v.tuDong) || 1),
                    moc: String(v.moc || '').trim(),
                    // Lọc TẦNG CODE — model vẫn hay lách blacklist (đo 2026-08-04:
                    // "burn scars on both hands" lan ra 709/1084 prompt).
                    moTa: lamSachMoTa(String(v.moTa || '').trim()),
                }))
                .filter((v: UkiyoeVariant) => !!v.moTa)
                .sort((a: UkiyoeVariant, b: UkiyoeVariant) => a.tuDong - b.tuDong),
        }))
        .filter((c: UkiyoeCharacter) => c.bienThe.length > 0);

    if (!list.length) throw new Error('Không phân tích được nhân vật (JSON rỗng).');
    return list;
};

// ─────────────────────────────────────────────────────────────────────────────
// SINH PROMPT CHO 1 LÔ CLIP (cùng một phân cảnh)
// ─────────────────────────────────────────────────────────────────────────────
export interface UkiyoeBatchResponse {
    items: { key: string; prompt: string }[];
    usage: ChatResult['usage'];
}

export const generateUkiyoePromptsBatch = async (args: {
    rows: { key: string; part: string; text: string; seconds: number }[];
    characters: UkiyoeCharacter[];
    /** dòng SRT đầu lô — để chọn ĐÚNG biến thể ngoại hình đang hiệu lực */
    cueIdMoc: number;
    model: string;
    styleSuffix: string;
    customInstructions: string;
    setting: string;
    signal?: AbortSignal;
}): Promise<UkiyoeBatchResponse> => {
    const { rows, characters, cueIdMoc, model, styleSuffix, customInstructions, setting, signal } = args;
    throwIfAborted(signal);

    // CODE chọn biến thể hiệu lực — AI chỉ việc dán, không tự suy diễn chặng truyện.
    // lamSachMoTa lần nữa: chặn cả dữ liệu cũ đã lưu từ trước khi có bộ lọc.
    const roster = characters.length
        ? characters.map(c => {
            const moTa = lamSachMoTa(moTaTaiDong(c, cueIdMoc));
            return `- ${c.ten}${c.laNhom ? ' (NHÓM)' : ''} — ${c.vai}\n  LOCKED: "${moTa}"`;
        }).join('\n')
        : '(không có danh sách nhân vật — tả chung chung, KHÔNG bịa tên)';

    const systemText = `ROLE: You are a director + storyboard artist writing Veo3 video prompts for a Japanese Edo-period folk tale rendered as moving ukiyo-e woodblock illustration.

════════ CHARACTER LOCK — MÔ TẢ, KHÔNG DÙNG TÊN ════════
Roster (mô tả đang hiệu lực ở đoạn truyện này):
${roster}
RULES:
- Khi một nhân vật xuất hiện trong cảnh, chèn NGUYÊN VĂN chuỗi LOCKED của họ vào prompt, không sửa một từ, không rút gọn, không thêm tính từ.
- TUYỆT ĐỐI KHÔNG viết tên nhân vật trong prompt (không "Osumi", không "the woman named…"). Chỉ mô tả.
- Nhiều nhân vật trong một cảnh → dán lần lượt từng chuỗi LOCKED, nối bằng hành động của họ.
- Nhóm (NHÓM) xuất hiện đông đủ → dán chuỗi LOCKED của nhóm. Nếu chỉ một người trong nhóm được nhắc riêng và người đó có mục riêng → dùng mục riêng.
- Người phụ không có trong roster → cụm generic ngắn ("an elderly village man"), không tên.

════════ SETTING LOCK ════════
Mọi clip trong lô này thuộc CÙNG một phân cảnh. Trong phần bối cảnh của MỌI prompt phải dùng đúng câu sau, nguyên văn:
"${setting}"

════════ CÁCH VIẾT MỖI PROMPT ════════
1. INPUT: mảng JSON các clip { "key", "part" (vd 2/3 = pha 2 của 3 pha cùng một câu), "text" (khúc lời kể của clip này), "seconds" }.
2. Mỗi clip đúng MỘT prompt, chỉ diễn tả nội dung "text" của clip đó. KHÔNG gộp, KHÔNG bỏ sót clip nào.
3. Mỗi prompt = MỘT hành động chính + MỘT chỉ dẫn máy quay, làm được trong số giây cho trước. Không montage.
4. Các clip cùng một câu (1/3, 2/3, 3/3) là các PHA nối tiếp: đổi cỡ cảnh và chi tiết giữa các clip liên tiếp, không tả lại y hệt một khoảnh khắc.
5. Clip liền nhau phải nối trạng thái: kết của clip trước là đầu của clip sau (vị trí, tư thế, thời tiết, ánh sáng).
6. Đây là TRUYỆN KỂ (narration ngoài hình), KHÔNG có thoại nhân vật: TUYỆT ĐỐI không viết lời thoại, không "speaks", không "says". Nhân vật chỉ biểu cảm và hành động.
7. Chuyển động hợp chất liệu tranh: máy quay chậm (slow pan, gentle push-in, static hold), nhân vật cử động vừa phải; tuyết rơi, rèm lay, lửa bập bùng là được.
8. HẬU TỐ PHONG CÁCH — TUYỆT ĐỐI KHÔNG VIẾT RA. Hệ thống tự nối vào cuối mọi prompt, viết lại chỉ tốn token. Chỉ cần prompt đọc trôi chảy khi nối thêm câu này ở cuối: "${styleSuffix}"
9. Âm thanh: chỉ tiếng môi trường (gió, tuyết, tiếng guốc gỗ, tiếng lửa, tiếng vải), thêm "no background music, no dialogue".
10. TỪ CẤM — Veo vẽ thành MÁU và MẶT NỨT VỠ (lỗi đo thực tế 2026-07-31):
   · "bleed" / "full bleed" → Veo hiểu là CHẢY MÁU. Muốn tả tràn khung thì viết "fills the entire frame".
   · "crackle" (tả tiếng lửa/nến) → Veo vẽ vết nứt. Dùng "soft popping of the flame" hoặc "gentle hiss of the lamp".
   · "cracked", "weathered", "chapped", "split" khi tả da/mặt → dùng "sun-tanned", "lined with age", "rough hands".
   · scar, wound, blood, bruise, cut, gash, injured → chỉ dùng khi cốt truyện BẮT BUỘC có thương tích, và phải tả gián tiếp (dải vải trắng quấn quanh tay), TUYỆT ĐỐI không tả vết thương hay vết sẹo trên mặt.
   · ragged / tattered / torn / threadbare / rags / half-naked / revealing / exposed skin khi tả trang phục → thay bằng "plain worn cotton kimono", "neatly patched faded kimono". Áo quần NGHÈO nhưng NGUYÊN VẸN, KÍN ĐÁO — Veo vẽ áo rách là lộ cơ thể nhạy cảm. Nhân vật NỮ dù khổ vẫn tả xinh đẹp ưa nhìn.
${customInstructions ? `\n════════ YÊU CẦU THÊM CỦA NGƯỜI DÙNG ════════\n${customInstructions}` : ''}

OUTPUT CHỈ JSON: {"items":[{"key":"<key>","prompt":"<prompt tiếng Anh>"}]}
Số phần tử phải BẰNG ĐÚNG số clip đầu vào, đúng thứ tự.
JSON SAFETY: TUYỆT ĐỐI không dùng dấu nháy kép (") bên trong prompt.`;

    const res = await callByModel(model, systemText, JSON.stringify(rows), signal);
    const data = cleanJson(res.text);
    const items: { key: string; prompt: string }[] = Array.isArray(data?.items) ? data.items : [];
    if (items.length !== rows.length) {
        throw new Error(`Lô trả về ${items.length}/${rows.length} prompt — thử lại.`);
    }

    // Hậu tố phong cách do CODE nối — AI khỏi viết lại mỗi clip (tiết kiệm token,
    // nguyên văn 100%). AI lỡ viết rồi thì không nối chồng.
    const suffix = styleSuffix.trim();
    const withStyle = items.map(it => {
        const p = String(it.prompt || '').trim();
        return { key: String(it.key), prompt: !suffix || p.includes(suffix) ? p : `${p} ${suffix}` };
    });
    return { items: withStyle, usage: res.usage };
};
