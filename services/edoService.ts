// ─────────────────────────────────────────────────────────────────────────────
// EDO @ (昔話 Nhật Bản) — prompt Veo3 cho truyện cổ dân gian Nhật thời Edo.
//
// BẢN SINH ĐÔI của joseonService (tab 3): cùng cơ chế đồng bộ @ + tạo hình —
// mỗi GIAI ĐOẠN nhân vật một mã @Ten, sinh PROMPT TẠO HÌNH nền trắng (FACE DNA
// dán nguyên văn mọi giai đoạn), prompt clip chỉ gọi SUBJECT_@Ten không tả
// ngoại hình. Khác duy nhất phần CHỐT CỨNG VĂN HÓA: trang phục/tóc theo thân
// phận Edo Nhật (nông dân, samurai, thương nhân, nhà sư…), kiến trúc minka/
// machiya/shoji/irori, CẤM lẫn Hàn/Trung (hanbok, gat, hanfu…).
// Kịch bản đầu vào thường TIẾNG NHẬT; prompt xuất ra TIẾNG ANH.
// Excel xuất CÙNG ĐỊNH DẠNG tab 3 Joseon (cùng sheet, cùng cột) cho tool ngoài.
// ─────────────────────────────────────────────────────────────────────────────

import type { SubtitleItem } from '../types';
import { callPortChat } from './portGateway';
import { callDirectChat, isDirectApiModel } from './directApiService';
import { callClaudeLocalChat, isClaudeLocalModel } from './claudeLocalService';
import { callClaudeSv2Chat, isClaudeSv2Model } from './claudeSv2Service';
import { throwIfAborted } from '../utils/stopControl';
import { withRetry } from '../utils/retry';
import { UKIYOE_DEFAULT_STYLE } from './ukiyoeService';
import { VEO_AUDIO_LOCK, styleDaChanAudio } from './joseonService';
import { lamSachMoTa } from '../utils/promptSanitizer';

/**
 * Style mặc định cho PROMPT CLIP — dùng lại bản Ukiyo-e đã kiểm chứng (chống
 * máu/mặt nứt/viền khung, đã có sẵn câu chặn audio ở cuối). Sửa được ở UI.
 */
export const EDO_DEFAULT_STYLE = UKIYOE_DEFAULT_STYLE;

/** Style cho PROMPT TẠO HÌNH nhân vật (nền trắng, tươi sáng) — bản Nhật của style tạo hình tab 3. */
export const EDO_CHAR_STYLE =
    'Traditional 2D Edo Japanese folk-tale animation, Japanese anime and ukiyo-e-inspired linework, ' +
    'bold black outlines, crisp cel shading, storybook illustration style, bright and colorful children’s ' +
    'animation look, vivid saturated colors, strong contrast, clear readable character design, ' +
    'bold primary and secondary colors, cheerful palette, clean color blocking, crisp color separation, ' +
    'clean flat colors, smooth polished finish, minimal texture overlay, white background, ' +
    'eye-level wide composition, sharp focus, highly detailed, polished high-resolution animation still.';

/**
 * GHI CHÚ VĂN HÓA CHO BẢN ĐỒ PHÂN CẢNH — truyền vào generateSceneMap để câu
 * "setting" ra đúng minka/machiya Edo thay vì "a village at dusk" chung chung.
 */
export const EDO_SCENE_NOTE = `WORLD: rural Japan, Edo period. The input script is usually in JAPANESE; write every setting sentence in ENGLISH.
Use concrete Edo-period vocabulary, never generic Asian wording: thatched-roof minka farmhouse, wooden machiya townhouse, shoji paper sliding doors, tatami mat room, sunken irori hearth with an iron kettle on a hook, engawa wooden veranda, noren curtain over a shop entrance, village Shinto shrine with a torii gate and stone lanterns, Buddhist temple hall, roadside inn on a stone-paved post road, terraced rice paddies, pine-covered hills, cedar forest path, wooden arched bridge over a stream, snow-covered mountain village, paper andon lamps glowing at dusk.
FORBIDDEN in every setting sentence: Korean hanok courtyards, jangdokdae jar terraces, Korean gat hats, Chinese red lanterns, curved Chinese pavilions, and anything modern.`;

/** Trang phục/tóc theo thân phận Edo — dùng chung cho pha tạo hình & pha viết clip. */
const EDO_COSTUME_RULES = `- Nông dân / tiều phu / người hầu (百姓・木こり・下男): rough indigo or grey-brown cotton work kimono with sleeves tied up, momohiki leggings, tenugui cloth tied around the head, straw waraji sandals. TUYỆT ĐỐI KHÔNG đeo kiếm, không hakama lụa.
- Đàn bà nông dân / hầu gái (下女): plain cotton kimono in dull indigo/brown/grey with a narrow simple obi, sleeves tied back with a tasuki cord, hair in a simple low bun, cloth head wrap when working.
- Samurai / võ sĩ: silk kimono with hakama trousers and haori jacket, chonmage topknot with shaved pate, two swords (daisho) at the left hip.
- Lãnh chúa / quan (大名・奉行): formal kamishimo with wide winged shoulders over fine silk kimono, chonmage, folding fan.
- Thương nhân (町人): subdued striped or plain cotton-silk kimono, short haori, soft zori sandals, KHÔNG kiếm.
- Nhà sư: shaved head, dark grey or black robe with a kesa sash, prayer beads.
- Thầy đồ / y sĩ: plain dark kimono and haori, thin beard, KHÔNG kiếm.
- Kỹ nữ / geisha (chỉ khi truyện nêu): layered colorful kimono with a wide obi tied at the back, shimada hairstyle with kanzashi hairpins.
- Trẻ em: bé trai đầu cạo chừa chỏm trước hoặc tóc ngắn, kimono ngắn màu mộc; bé gái tóc okappa hoặc bím ngắn với dây buộc đỏ, kimono màu tươi. TUYỆT ĐỐI KHÔNG chonmage, không kiếm.
- Đàn bà đã chồng: búi marumage. Gái chưa chồng: tóc momoware hoặc xõa buộc thấp. Đàn ông thường dân trưởng thành: topknot mộc, có thể quấn khăn tenugui — kiểu tóc theo thân phận đôi khi CHÍNH LÀ nút thắt của truyện, đọc kỹ.
- NGHÈO / KHỔ / TÙ TỘI: thể hiện bằng vải mộc bạc màu + áo vá GỌN GÀNG (neatly patched), KHÔNG rách nát — CẤM ragged/tattered/torn/rags/half-naked/revealing (Veo vẽ áo rách là lộ cơ thể nhạy cảm). Nhân vật NỮ dù nghèo khổ vẫn tả XINH ĐẸP ưa nhìn, áo NGUYÊN VẸN KÍN ĐÁO; nỗi khổ lộ qua ánh mắt và dáng vẻ, không qua rách rưới hay thân hình tiều tụy.
- CẤM TUYỆT ĐỐI lẫn văn hóa khác: hanbok, jeogori/chima, nón gat Hàn, trâm binyeo, hanfu, cheongsam/qipao, đuôi sam kiểu Thanh. Chỉ trang phục Nhật thời Edo.`;

/** Một GIAI ĐOẠN của nhân vật — mỗi giai đoạn một ảnh tham chiếu, một mã @. */
export interface EdoStage {
    /** dòng SRT bắt đầu áp dụng (1 = từ đầu truyện) */
    tuDong: number;
    /** mốc đổi, tiếng Việt ngắn (vd "tuổi nhỏ 4–10") */
    moc: string;
    /** mã gọi trong prompt clip, KHÔNG kèm @ (vd "Taro_child") — rỗng = không vẽ */
    ma: string;
    /** mô tả ngắn giai đoạn (tuổi, thân phận, trang phục) — để soát bằng mắt */
    tomTat: string;
    /** prompt tạo hình đầy đủ (đã nối hậu tố style tạo hình) */
    promptTaoHinh: string;
}

export interface EdoCharacter {
    ten: string;
    vai: string;
    /** true = nhóm người (dân làng, gia nhân, đám trẻ) — KHÔNG vẽ ảnh, tả generic trong cảnh */
    laNhom?: boolean;
    /** NÉT MẶT BẤT BIẾN — dán nguyên văn vào mọi giai đoạn để bé/già vẫn một người */
    faceDna: string;
    /** các giai đoạn, sắp xếp tăng dần theo tuDong (ít nhất 1) */
    giaiDoan: EdoStage[];
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

/** Mã @ chỉ được có chữ/số/gạch dưới — Veo hay nuốt ký tự lạ trong tên. */
const chuanHoaMa = (raw: string, fallback: string): string => {
    const s = String(raw || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')  // bỏ dấu tiếng Việt
        .replace(/[^A-Za-z0-9_]/g, '');                    // bỏ mọi ký tự còn lại
    return s || fallback;
};

/** Mã @ hiệu lực của nhân vật tại dòng SRT `cueId` (giai đoạn mới nhất đã tới mốc). */
export const maTaiDong = (c: EdoCharacter, cueId: number): string => {
    let out = c.giaiDoan[0]?.ma || '';
    for (const g of c.giaiDoan) if (g.tuDong <= cueId) out = g.ma;
    return out;
};

/** Tóm tắt giai đoạn hiệu lực tại dòng `cueId` — cho AI hiểu ai là ai (không dán vào prompt). */
export const tomTatTaiDong = (c: EdoCharacter, cueId: number): string => {
    let out = c.giaiDoan[0]?.tomTat || '';
    for (const g of c.giaiDoan) if (g.tuDong <= cueId) out = g.tomTat;
    return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// PHA 1 — TÁCH NHÂN VẬT, CHỐT FACE DNA & CÁC GIAI ĐOẠN (1 lượt đọc toàn truyện)
// ─────────────────────────────────────────────────────────────────────────────
export const analyzeEdoCharacters = async (args: {
    items: SubtitleItem[];
    model: string;
    signal?: AbortSignal;
}): Promise<EdoCharacter[]> => {
    const { items, model, signal } = args;
    throwIfAborted(signal);

    // Truyện dài: lấy mẫu đều toàn bộ để thấy cả biến đổi cuối truyện.
    const MAX = 320;
    const step = Math.max(1, Math.ceil(items.length / MAX));
    const sample = items.filter((_, i) => i % step === 0).map(it => `${it.id}. ${it.text}`).join('\n');

    const systemText = `ROLE: Bạn là đạo diễn casting cho phim hoạt hình 2D truyện cổ dân gian Nhật Bản (昔話) thời Edo.

NHIỆM VỤ: đọc kịch bản (đánh số theo dòng phụ đề, thường là TIẾNG NHẬT) rồi lập DANH SÁCH NHÂN VẬT kèm NÉT MẶT BẤT BIẾN và CÁC GIAI ĐOẠN của từng người. Mọi mô tả viết bằng TIẾNG ANH.

════════ CHỌN NHÂN VẬT ════════
- Tổng 8–12 mục. Gồm: nhân vật chính, nhân vật phụ xuất hiện nhiều, nhân vật đơn lẻ nhưng có vai trò rõ.
- NHÓM người xuất hiện cùng nhau (dân làng, gia nhân, đám trẻ, toán lính) → 1 mục với "laNhom": true. NHÓM KHÔNG VẼ ẢNH: mọi giai đoạn của nhóm để "ma": "" (chuỗi rỗng), và "tomTat" là cụm TIẾNG ANH generic ngắn để tả thẳng trong cảnh, ví dụ "a group of seven villagers in rough indigo work clothes". SỐ LƯỢNG lấy đúng con số truyện nêu; truyện không nêu thì ghi "a small group of". Nhóm chỉ cần 1 giai đoạn.
- Nếu một người trong nhóm về sau tách ra có vai trò riêng → THÊM mục riêng cho người đó.
- Bỏ qua người chỉ thoáng qua 1 câu không ảnh hưởng truyện.

════════ faceDna — NÉT MẶT BẤT BIẾN (quan trọng nhất) ════════
Một cụm TIẾNG ANH 12–22 từ, CHỈ tả những thứ KHÔNG đổi theo tuổi tác hay giàu nghèo:
dáng khuôn mặt · dáng mắt · lông mày · mũi · miệng
Ví dụ đạt (kịch bản không nêu mark): "oval face, wide-set almond eyes with a gentle downturn, thick straight brows, small straight nose, thin closed lips"
Ví dụ đạt CHỈ khi nguồn nêu: source says a mole on the right cheek → "oval face, wide-set almond eyes with a gentle downturn, thick straight brows, small straight nose, a small mole on the right cheek"
- Điểm nhấn mặt (nốt ruồi, lúm đồng tiền, sẹo, vết bớt, chân mày lệch…) CHỈ được viết khi kịch bản gốc nêu rõ — đúng người, đúng vị trí, đúng mô tả. Không nêu thì KHÔNG có. CẤM bịa mole / beauty mark / dimple / birthmark. CẤM "mỗi nhân vật một điểm nhấn khác nhau".
- CẤM đưa vào faceDna: tuổi, tóc, mũ, trang phục, vóc dáng, nếp nhăn, râu — đó là thứ đổi theo giai đoạn.
- CẤM từ gợi thương tích BỊA: scar, wound, blood, bruise, crack, cut, burn, gaunt, haggard, weathered, chapped. Truyện thật sự mô tả sẹo thì mới được ghi, đúng như nguồn.
- Nhóm người (laNhom) không vẽ ảnh nên faceDna để rỗng "".

════════ GIAI ĐOẠN (mỗi giai đoạn CÓ MÃ sẽ là MỘT ảnh nhân vật riêng) ════════
GỘP TỐI ĐA — mỗi ảnh là một lần phải vẽ tay, tách vụn là hại. Luật theo tuổi, bắt buộc:
- SƠ SINH / ẵm ngửa (0–3 tuổi): KHÔNG tạo ảnh. Đặt "ma": "" (chuỗi rỗng) và "tomTat" là cụm TIẾNG ANH generic ngắn dùng để tả thẳng trong cảnh, ví dụ "a swaddled newborn baby wrapped in white cloth". Em bé quấn tã nhìn đâu cũng như nhau, vẽ riêng chỉ phí.
- TRẺ CON 4–13 tuổi: CHỈ MỘT giai đoạn duy nhất cho cả quãng này, dù truyện kể từ 4 tuổi tới 10 tuổi. Mặt trẻ con vẽ kiểu tròn đáng yêu vốn na ná nhau, đủ dùng. "moc" ghi gộp, vd "tuổi nhỏ 4–10".
- TỪ 14 TUỔI TRỞ LÊN: lúc này mới tách giai đoạn thật — thiếu niên → trưởng thành → đổi thân phận (đỗ đạt, thành samurai, giàu lên) → già tóc bạc.
- NGƯỜI LỚN: chỉ tách khi thân phận hoặc trang phục đổi HẲN (người hầu→chủ quán, nghèo→giàu, chưa vợ→có vợ nên đổi kiểu tóc, trung niên→già tóc bạc). Bẩn/sạch, ướt mưa, buồn/vui, mệt mỏi KHÔNG phải giai đoạn mới.
- TỐI ĐA 3 giai đoạn CÓ MÃ cho một người (giai đoạn sơ sinh không tính vì không có ảnh).
Mỗi giai đoạn gồm:
- "tuDong": SỐ DÒNG PHỤ ĐỀ mà từ đó ngoại hình mới bắt đầu (giai đoạn đầu luôn là 1). Đọc kỹ để lấy đúng mốc.
- "moc": lý do đổi, tiếng Việt ngắn (vd "tuổi nhỏ 4–10"; "10 năm sau, thành thương nhân giàu").
- "ma": MÃ GỌI trong prompt — CHỈ chữ Latinh không dấu, số và gạch dưới, dạng TenNhanVat_ChangTruyen, ví dụ Taro_child, Taro_merchant, Okiku_old. Mỗi giai đoạn một mã DUY NHẤT trong toàn bộ danh sách. Riêng giai đoạn sơ sinh để rỗng "".
- "tomTat": một câu TIẾNG ANH ngắn (10–18 từ) nêu tuổi + thân phận + tóc/mũ + trang phục Edo của giai đoạn đó.
Nhân vật không đổi ngoại hình thì chỉ 1 giai đoạn.

════════ TRANG PHỤC & TÓC PHẢI ĐÚNG THÂN PHẬN EDO NHẬT ════════
${EDO_COSTUME_RULES}

OUTPUT CHỈ JSON, không lời dẫn:
{"characters":[{"ten":"Tên (phiên âm)","vai":"vai trò ngắn","laNhom":false,"faceDna":"...","giaiDoan":[{"tuDong":1,"moc":"ban đầu","ma":"Ten_chang","tomTat":"..."}]}]}
JSON SAFETY: TUYỆT ĐỐI không dùng dấu nháy kép (") bên trong giá trị chuỗi.`;

    const res = await withRetry(
        () => callByModel(model, systemText, sample, signal),
        3, undefined, signal
    );
    const data = cleanJson(res.text);
    const daDung = new Set<string>();

    const list: EdoCharacter[] = (Array.isArray(data?.characters) ? data.characters : [])
        .map((c: any, ci: number) => {
            const ten = String(c.ten || '').trim() || `Nhanvat${ci + 1}`;
            // Nhóm người KHÔNG vẽ ảnh — ép rỗng ở đây phòng khi AI vẫn trả mã.
            const laNhom = !!c.laNhom;
            const stages: EdoStage[] = (Array.isArray(c.giaiDoan) ? c.giaiDoan : [])
                .map((g: any, gi: number) => {
                    // Mã rỗng = giai đoạn KHÔNG vẽ ảnh (sơ sinh, nhóm người) → tả generic trong cảnh.
                    // Còn lại: mã phải sạch và DUY NHẤT — trùng mã là hai người dùng chung một ảnh.
                    const raw = laNhom ? '' : String(g.ma || '').trim();
                    let ma = '';
                    if (raw) {
                        ma = chuanHoaMa(raw, `Nhanvat${ci + 1}_${gi + 1}`);
                        while (daDung.has(ma.toLowerCase())) ma = `${ma}_${gi + 1}`;
                        daDung.add(ma.toLowerCase());
                    }
                    return {
                        tuDong: Math.max(1, Number(g.tuDong) || 1),
                        moc: String(g.moc || '').trim(),
                        ma,
                        // Lọc tầng code — model hay lách blacklist (scar/ragged/bloodshot…).
                        tomTat: lamSachMoTa(String(g.tomTat || '').trim()),
                        promptTaoHinh: '',
                    };
                })
                .sort((a: EdoStage, b: EdoStage) => a.tuDong - b.tuDong);
            return {
                ten,
                vai: String(c.vai || '').trim(),
                laNhom,
                faceDna: laNhom ? '' : lamSachMoTa(String(c.faceDna || '').trim()),
                giaiDoan: stages,
            };
        })
        .filter((c: EdoCharacter) => c.giaiDoan.length > 0);

    if (!list.length) throw new Error('Không phân tích được nhân vật (JSON rỗng).');
    return list;
};

// ─────────────────────────────────────────────────────────────────────────────
// PHA 2 — SINH PROMPT TẠO HÌNH CHO TỪNG GIAI ĐOẠN
// Chạy theo lô để truyện đông nhân vật không cụt JSON. FACE DNA dán nguyên văn
// ở mọi giai đoạn ⇒ bé/lớn/nghèo/giàu vẫn cùng một khuôn mặt.
// ─────────────────────────────────────────────────────────────────────────────
export const generateEdoCharacterSheets = async (args: {
    characters: EdoCharacter[];
    model: string;
    /** hậu tố style tạo hình — code tự nối, AI không phải viết */
    charStyle: string;
    customInstructions: string;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
}): Promise<EdoCharacter[]> => {
    const { characters, model, charStyle, customInstructions, signal, onProgress } = args;
    throwIfAborted(signal);

    // Chỉ vẽ giai đoạn CÓ MÃ — chặng sơ sinh và nhóm người mã rỗng nên tự loại.
    // Chia lô 8 giai đoạn/lượt cho JSON khỏi cụt.
    const flat = characters.filter(c => !c.laNhom).flatMap(c => c.giaiDoan.filter(g => !!g.ma).map(g => ({
        ma: g.ma,
        ten: c.ten,
        vai: c.vai,
        faceDna: c.faceDna,
        moc: g.moc,
        tomTat: g.tomTat,
    })));
    const LO = 8;
    const batches: typeof flat[] = [];
    for (let i = 0; i < flat.length; i += LO) batches.push(flat.slice(i, i + LO));

    const systemText = `ROLE: Bạn là họa sĩ thiết kế tạo hình (character sheet) cho phim hoạt hình 2D truyện cổ dân gian Nhật Bản thời Edo.

NHIỆM VỤ: mỗi mục đầu vào là MỘT GIAI ĐOẠN của một nhân vật. Viết cho mỗi mục MỘT PROMPT TIẾNG ANH để vẽ ảnh tạo hình nhân vật đó. Ảnh này sẽ được dùng làm ẢNH THAM CHIẾU cho mọi cảnh phim, nên phải sạch, rõ, đủ chi tiết nhận diện.

════════ GIỮ NGUYÊN KHUÔN MẶT (luật số 1) ════════
- Mỗi mục có "faceDna" — chuỗi tả nét mặt bất biến. PHẢI chèn NGUYÊN VĂN chuỗi đó vào prompt, không sửa một từ, không rút gọn, không thay từ đồng nghĩa.
- Các giai đoạn khác nhau của CÙNG một người dùng CÙNG một faceDna ⇒ bé hay già, nghèo hay giàu vẫn phải nhận ra là một người. Chỉ được đổi: tuổi, tóc/mũ, trang phục, vóc dáng, thần thái.
- Tuổi thể hiện bằng tỉ lệ đầu-người, độ đầy đặn của má, dáng lưng — KHÔNG bằng cách đổi kiểu mắt, mũi, miệng.
- Chèn faceDna nguyên văn; không thêm mole / beauty mark / dimple / birthmark mới. Nếu faceDna không có mark thì prompt tạo hình cũng không được thêm.

════════ CẤU TRÚC MỖI PROMPT ════════
Một đoạn tiếng Anh liền mạch, theo thứ tự:
1. Loại ảnh: full body character design sheet, single character standing in a relaxed neutral pose, facing the viewer, full figure visible from head to feet.
2. Tuổi + giới + thân phận Edo (theo "tomTat").
3. Chuỗi faceDna NGUYÊN VĂN.
4. Tóc/mũ đúng thân phận và tình trạng hôn nhân.
5. Trang phục kimono/áo Edo đúng thân phận: loại áo, màu, chất vải, giày/dép, phụ kiện đặc trưng.
6. Vóc dáng + thần thái của giai đoạn đó (vd nhẫn nhịn, hoạt bát, uy nghi).
7. Kết bằng: plain white background, no props, no scenery, no other characters.
- Đầu vào chỉ có nhân vật cá nhân — nhóm người không vẽ ảnh nên sẽ không xuất hiện ở đây.

════════ CẤM ════════
- CẤM viết tên nhân vật, mã, chữ Nhật (kanji/kana) hay bất kỳ chữ nào vào prompt (ảnh không được có chữ).
- CẤM bối cảnh, đạo cụ cầm tay lớn, hiệu ứng ánh sáng phim, khung tranh, nhiều góc nhìn trong một ảnh.
- CẤM tự thêm từ gợi thương tích: scar, wound, blood, bruise, crack, cracked, weathered, chapped, gaunt, haggard, injured — trừ khi faceDna đã có vì kịch bản nêu. Nhân vật khổ cực thì tả bằng áo vá, vai gầy, lưng hơi còng.
- CẤM lẫn văn hóa: hanbok, jeogori, chima, nón gat, trâm binyeo, hanfu, cheongsam, đuôi sam kiểu Thanh, đồ hiện đại.
- HẬU TỐ PHONG CÁCH: TUYỆT ĐỐI KHÔNG VIẾT RA — hệ thống tự nối. Chỉ cần prompt đọc trôi chảy khi nối thêm câu này ở cuối: "${charStyle}"

════════ TRANG PHỤC & TÓC THEO THÂN PHẬN ════════
${EDO_COSTUME_RULES}
${customInstructions ? `\n════════ YÊU CẦU THÊM CỦA NGƯỜI DÙNG ════════\n${customInstructions}` : ''}

OUTPUT CHỈ JSON: {"items":[{"ma":"<mã đầu vào>","prompt":"<prompt tiếng Anh>"}]}
Số phần tử BẰNG ĐÚNG số mục đầu vào, đúng thứ tự.
JSON SAFETY: TUYỆT ĐỐI không dùng dấu nháy kép (") bên trong prompt.`;

    const promptByMa = new Map<string, string>();
    let done = 0;
    for (const batch of batches) {
        throwIfAborted(signal);
        const res = await withRetry(
            () => callByModel(model, systemText, JSON.stringify(batch), signal),
            3, undefined, signal
        );
        const data = cleanJson(res.text);
        const items: { ma: string; prompt: string }[] = Array.isArray(data?.items) ? data.items : [];
        if (items.length !== batch.length) {
            throw new Error(`Lô tạo hình trả về ${items.length}/${batch.length} prompt — thử lại.`);
        }
        for (const it of items) promptByMa.set(String(it.ma), String(it.prompt || '').trim());
        done += batch.length;
        onProgress?.(done, flat.length);
    }

    // Hậu tố style do CODE nối — nguyên văn 100%, AI khỏi viết lại từng ảnh.
    const suffix = charStyle.trim();
    return characters.map(c => ({
        ...c,
        giaiDoan: c.giaiDoan.map(g => {
            const body = promptByMa.get(g.ma) || '';
            const full = !body ? '' : (!suffix || body.includes(suffix) ? body : `${body} ${suffix}`);
            return { ...g, promptTaoHinh: full };
        }),
    }));
};

// ─────────────────────────────────────────────────────────────────────────────
// PHA 3 — SINH PROMPT CLIP CHO 1 LÔ (cùng một phân cảnh)
// Prompt chỉ gọi SUBJECT_@Ma — ngoại hình do ảnh tham chiếu lo, không tả bằng chữ.
// ─────────────────────────────────────────────────────────────────────────────
export interface EdoBatchResponse {
    items: { key: string; prompt: string }[];
    usage: ChatResult['usage'];
}

export const generateEdoPromptsBatch = async (args: {
    rows: { key: string; part: string; text: string; seconds: number }[];
    characters: EdoCharacter[];
    /** dòng SRT đầu lô — để chọn ĐÚNG mã @ của giai đoạn đang hiệu lực */
    cueIdMoc: number;
    model: string;
    styleSuffix: string;
    customInstructions: string;
    setting: string;
    signal?: AbortSignal;
}): Promise<EdoBatchResponse> => {
    const { rows, characters, cueIdMoc, model, styleSuffix, customInstructions, setting, signal } = args;
    throwIfAborted(signal);

    // CODE chọn mã giai đoạn hiệu lực — AI chỉ việc gọi tên, không tự suy diễn chặng truyện.
    const roster = characters.length
        ? characters.map(c => {
            const ma = maTaiDong(c, cueIdMoc);
            const tt = tomTatTaiDong(c, cueIdMoc);
            // Mã rỗng = không có ảnh riêng (nhóm người, chặng sơ sinh) → tả thẳng bằng cụm generic.
            if (!ma) {
                const fallback = c.laNhom ? 'a small group of village folk' : 'a swaddled newborn baby';
                return `- ${c.ten} (${c.vai})${c.laNhom ? ' [NHÓM]' : ''} — KHÔNG CÓ MÃ: tả thẳng bằng cụm "${tt || fallback}", KHÔNG dùng SUBJECT_@, KHÔNG gọi tên.`;
            }
            return `- @${ma} = ${c.ten}, ${c.vai}${tt ? ` — hiện tại: ${tt}` : ''}`;
        }).join('\n')
        : '(không có danh sách nhân vật — tả chung chung, KHÔNG bịa tên)';

    // Style của người dùng chưa chặn audio → code nối thêm khóa âm thanh
    // (không nối trùng nếu style đã tự có câu chặn — EDO_DEFAULT_STYLE đã có sẵn).
    const styleClean = styleSuffix.trim();
    const fullSuffix = styleDaChanAudio(styleClean)
        ? styleClean
        : [styleClean, VEO_AUDIO_LOCK].filter(Boolean).join(' ');

    const systemText = `ROLE: You are a director + storyboard artist writing Veo3 video prompts for a Japanese Edo-period folk tale (昔話) rendered as traditional 2D hand-painted animation. The narration script is in JAPANESE; every prompt you write must be in ENGLISH.

════════ CHARACTER NAME LOCK — GỌI MÃ, TUYỆT ĐỐI KHÔNG TẢ NGOẠI HÌNH ════════
Danh sách mã đang hiệu lực ở đoạn truyện này (phần sau dấu = chỉ để BẠN hiểu ai là ai, CẤM chép vào prompt):
${roster}
RULES:
- Gọi nhân vật DUY NHẤT bằng "SUBJECT_@Ma" — đúng mã ở trên, không thêm chữ nào phía sau.
- Mã ở trên đã là giai đoạn ĐÚNG của đoạn truyện này. CẤM tự đổi sang mã giai đoạn khác, CẤM tự chế mã mới.
- CẤM viết tuổi, khuôn mặt, tóc, trang phục, vóc dáng của nhân vật vào prompt — ảnh tham chiếu lo phần đó. Chỉ viết HÀNH ĐỘNG, VỊ TRÍ, BIỂU CẢM.
- Nhiều nhân vật trong một cảnh → gọi lần lượt từng SUBJECT_@Ma, nối bằng hành động.
- Người phụ không có trong danh sách → cụm generic ngắn ("an elderly village man"), KHÔNG mã, KHÔNG tên riêng.
- Dòng nào ghi "KHÔNG CÓ MÃ" → dùng đúng cụm generic trong ngoặc kép, tuyệt đối không bịa mã cho họ.

════════ SETTING LOCK ════════
Mọi clip trong lô này thuộc CÙNG một phân cảnh. Trong phần bối cảnh của MỌI prompt phải dùng đúng câu sau, nguyên văn:
"${setting}"

════════ EDO WORLD LOCK (chốt cứng, không được lệch) ════════
- Kiến trúc: minka mái rạ (nhà nghèo) hoặc machiya gỗ (nhà phố), cửa lùa giấy shoji, phòng chiếu tatami, bếp lõm irori giữa nhà treo ấm sắt, hiên gỗ engawa, rèm noren, đền thần đạo có cổng torii và đèn đá, chùa Phật, quán trọ ven đường cái quan.
- Đồ vật: đèn giấy andon, ấm sắt tetsubin, thùng gỗ, bàn thấp, gùi củi, kiệu kago, guốc geta và dép rơm waraji, ô giấy wagasa, chiếu rơm, cối đá, chum nước.
- Thiên nhiên: đồi thông, rừng tuyết tùng, ruộng bậc thang, suối đá, tuyết phủ bản làng, hoa mai và hoa anh đào, quạ đen.
- CẤM TUYỆT ĐỐI: sân hanok Hàn, dãy chum jangdokdae, nón gat, trâm binyeo, đèn lồng đỏ Trung Hoa, mái đao cong kiểu Tàu, và mọi đồ hiện đại (kính cửa sổ, dây điện, gạch nung đỏ).

════════ CÁCH VIẾT MỖI PROMPT ════════
1. INPUT: mảng JSON các clip { "key", "part" (vd 2/3 = pha 2 của 3 pha cùng một câu), "text" (khúc lời kể tiếng Nhật của clip này), "seconds" }.
2. Mỗi clip đúng MỘT prompt, chỉ diễn tả nội dung "text" của clip đó. KHÔNG gộp, KHÔNG bỏ sót clip nào.
3. Mỗi prompt = MỘT hành động chính + MỘT chỉ dẫn máy quay, làm được trong số giây cho trước. Không montage.
4. Thứ tự trong prompt: SUBJECT_@Ma → hành động (đầu → cuối) → câu bối cảnh khóa → máy quay (cỡ cảnh + chuyển động) → âm thanh môi trường.
5. Các clip cùng một câu (1/3, 2/3, 3/3) là các PHA nối tiếp: đổi cỡ cảnh và chi tiết giữa các clip liên tiếp, không tả lại y hệt một khoảnh khắc.
6. Clip liền nhau phải nối trạng thái: kết của clip trước là đầu của clip sau (vị trí, tư thế, thời tiết, ánh sáng).
7. TUYỆT ĐỐI KHÔNG GIỌNG NGƯỜI (CRITICAL — lỗi dính nhiều nhất): video KHÔNG được có bất kỳ giọng người nào — không thoại, không lời kể, không hát, không ngân nga, không thì thầm (voice-over sẽ lồng sau, ngoài hệ thống). CẤM viết lời thoại; CẤM các từ speaks, says, tells, asks, answers, shouts, calls out, replies, mutters, exclaims; CẤM trích câu phụ đề thành lời nói. Lời trong ngoặc kép của kịch bản → chuyển thành cử chỉ, ánh mắt, nét mặt. Nhân vật ĐƯỢC há miệng (gọi, khóc, cười) nhưng phần âm thanh chỉ tả ambience/SFX. MỖI prompt phải có phần âm thanh ở CUỐI và kết đúng bằng cụm: no dialogue audio, no voice, no music.
8. Chuyển động hợp hoạt hình vẽ tay: máy quay chậm (slow pan, gentle push-in, static hold), nhân vật cử động vừa phải; tuyết rơi, khói bếp, cỏ lay, lửa đèn dầu là được.
9. HẬU TỐ PHONG CÁCH — TUYỆT ĐỐI KHÔNG VIẾT RA. Hệ thống tự nối vào cuối mọi prompt. Chỉ cần prompt đọc trôi chảy khi nối thêm câu này ở cuối: "${fullSuffix}"
10. TỪ CẤM — Veo vẽ thành MÁU và MẶT NỨT VỠ (lỗi đo thực tế 2026-07-31):
   · "bleed" / "full bleed" → Veo hiểu là CHẢY MÁU. Muốn tả tràn khung thì viết "fills the entire frame".
   · "crackle" (tả tiếng lửa/nến) → Veo vẽ vết nứt. Dùng "soft popping of the flame".
   · "cracked", "weathered", "chapped", "split" khi tả da/mặt → dùng "sun-tanned", "lined with age", "rough hands".
   · scar, wound, blood, bruise, cut, gash, injured, whipped → cảnh đòn roi/tra khảo chỉ được tả GIÁN TIẾP: tư thế quỳ gục, vai run, áo lấm bụi, người khác đỡ dậy. TUYỆT ĐỐI không tả vết thương hay máu.
   · ragged / tattered / torn / threadbare / rags / half-naked / revealing / exposed skin khi tả trang phục → thay bằng "plain worn cotton kimono", "neatly patched faded kimono". Áo quần NGHÈO nhưng NGUYÊN VẸN, KÍN ĐÁO — Veo vẽ áo rách là lộ cơ thể nhạy cảm. Nhân vật NỮ dù khổ vẫn tả xinh đẹp ưa nhìn.
11. KHÔNG dựng cảnh có chữ trong khung hình: không biển hiệu có chữ, không sách mở thấy chữ, không thư từ trải rộng, không thư pháp treo tường. Cần tả chữ nghĩa thì quay góc thấy giấy nghiêng, tay cầm bút, cuộn giấy cuộn lại.
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

    // Hậu tố (style + khóa âm thanh nếu cần) do CODE nối — AI khỏi viết lại mỗi clip.
    const suffix = fullSuffix.trim();
    const withStyle = items.map(it => {
        const p = String(it.prompt || '').trim();
        return { key: String(it.key), prompt: !suffix || p.includes(suffix) ? p : `${p} ${suffix}` };
    });
    return { items: withStyle, usage: res.usage };
};
