
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { SettingsPanel } from './components/SettingsPanel';
import { ResultsTable } from './components/ResultsTable';
import { FileUpload } from './components/FileUpload';
import { ActionButtons } from './components/ActionButtons';
import { StatusBar } from './components/StatusBar';
import { CharacterManager } from './components/CharacterManager';
import { ReferenceManager } from './components/ReferenceManager';
import { ImageGenPanel } from './components/ImageGenPanel';
import { CharacterGenPanel } from './components/CharacterGenPanel';
import { Veo3Panel } from './components/Veo3Panel';
import type { PromptResult, CharacterProfile, TokenUsage, ReferenceImage, ImageJob, SubtitleItem, BatchImageProject } from './types';
import {
    DEFAULT_PROMPT_TEXT_MODEL,
    PROMPT_TEXT_MODEL_OPTIONS,
    generatePromptsForLines,
    generateStandaloneImagePromptsForLines,
    generateVeo3PromptsFromSrt,
    analyzeCharacters
} from './services/geminiService';
import type { PromptTextModelId } from './services/geminiService';
import { exportToExcel, exportVeo3PromptsToExcel } from './services/excelExporter';
import { withRetry, OnRetryCallback } from './utils/retry';
import { isStopError } from './utils/stopControl';
import { parseFile } from './services/fileParser';
import { mergeSubtitlesIntoScenes } from './services/sceneMerger';
import { groupSubtitlesWithAi } from './services/aiSceneGroupingService';
import { updateUserToken } from './services/tokenService';
import { hasPortsConfigured } from './services/portGateway';
import { isDirectApiModel, getDirectApiChunkSize } from './services/directApiService';
import ScriptWorkspace from './components/ScriptWorkspace';
import Veo3PromptsPanel from './components/Veo3PromptsPanel';
import TongTaiPanel from './components/TongTaiPanel';
import UkiyoePanel from './components/UkiyoePanel';
import JoseonPanel from './components/JoseonPanel';
import EdoPanel from './components/EdoPanel';
import IsekaiPromptPanel from './components/IsekaiPromptPanel';
import {
    EDO_CHAR_STYLE,
    EdoCharacter,
    maTaiDong,
    tomTatTaiDong,
} from './services/edoService';
import { resolveImageTabCast } from './services/imageCast';
import {
    formatPromptLineError,
    imagePromptChunkSize,
    isUsableImagePrompt,
    recoverPromptBatch,
} from './utils/promptBatchRecovery';
import { withTransientRetries } from './utils/llmRetry';
import TTSGeminiPanel from './components/TTSGeminiPanel';
import CampContentPanel from './components/CampContentPanel';
import UpdateButton from './components/UpdateButton';
import EndpointSettingsModal from './components/EndpointSettingsModal';

const IMAGE_TAB_LOCKED = false;
const APP_VERSION = '3.10.5';

/**
 * Điều hướng 2 cấp: nhóm tab tổng → tab con.
 * Bấm nhóm là nhảy vào tab con đầu tiên; nhóm 1 tab thì ẩn hàng tab con.
 */
type TabId = 'prompt' | 'isekai-prompt' | 'prompt2' | 'image' | 'batch-image' | 'veo3-prompt' | 'veo3' | 'tts-gemini' | 'camp-content'
    | 'localization' | 'reverse-thinking' | 'fresh-rewrite' | 'manhwa' | 'veo3-prompts' | 'tong-tai' | 'ukiyoe' | 'joseon' | 'edo-at';

const TAB_GROUPS: {
    id: string; label: string; icon: string; color: string;
    tabs: { id: TabId; label: string; icon: string; hint?: string }[];
}[] = [
    {
        id: 'image', label: 'Prompts Ảnh', icon: 'fa-images', color: 'bg-blue-600',
        tabs: [
            { id: 'prompt', label: 'Prompts 1', icon: 'fa-paragraph', hint: 'có nhân vật' },
            { id: 'isekai-prompt', label: 'Isekai', icon: 'fa-khanda', hint: 'dị giới · 1 dòng 1 ảnh' },
            { id: 'prompt2', label: 'Prompts 2', icon: 'fa-landmark', hint: 'không nhân vật' },
        ],
    },
    {
        id: 'veo3', label: 'Prompts Veo3', icon: 'fa-clapperboard', color: 'bg-rose-600',
        tabs: [
            { id: 'veo3-prompts', label: '1. Đồng bộ nhân vật', icon: 'fa-user-check', hint: 'ảnh tham chiếu' },
            { id: 'ukiyoe', label: '2. Ukiyo-e Edo', icon: 'fa-torii-gate', hint: 'khóa bằng mô tả' },
            { id: 'joseon', label: '3. Joseon', icon: 'fa-mountain-sun', hint: 'truyện Hàn 야담' },
            { id: 'edo-at', label: '4. Edo @', icon: 'fa-fan', hint: 'truyện Nhật 昔話' },
        ],
    },
    {
        id: 'tong-tai', label: 'Phim Tổng Tài', icon: 'fa-crown', color: 'bg-amber-600',
        tabs: [{ id: 'tong-tai', label: 'Phim Tổng Tài', icon: 'fa-crown' }],
    },
    {
        id: 'viet-bai', label: 'Viết Bài', icon: 'fa-pen-nib', color: 'bg-purple-600',
        tabs: [
            { id: 'fresh-rewrite', label: 'Viết Lại', icon: 'fa-pen-nib' },
            { id: 'reverse-thinking', label: 'Tư Duy Ngược', icon: 'fa-wand-magic-sparkles' },
            { id: 'localization', label: 'Bản Địa Hóa', icon: 'fa-globe' },
            { id: 'manhwa', label: 'Manhwa', icon: 'fa-book-open' },
        ],
    },
    // TẠM ẨN 2 tab theo yêu cầu anh chủ 2026-08-10 (bản 3.1.0) — code giữ nguyên,
    // bỏ comment 2 khối dưới là hiện lại ngay:
    // {
    //     id: 'tts-gemini', label: 'TTS Gemini', icon: 'fa-microphone', color: 'bg-teal-600',
    //     tabs: [{ id: 'tts-gemini', label: 'TTS Gemini', icon: 'fa-microphone' }],
    // },
    // {
    //     id: 'camp-content', label: 'Camp Content', icon: 'fa-film', color: 'bg-indigo-600',
    //     tabs: [{ id: 'camp-content', label: 'Camp Content', icon: 'fa-film' }],
    // },
];

// ─── Tab Prompts Ảnh 1 — cơ chế @ giai đoạn (học từ tab 4. Edo @ Prompts Veo3) ───

/** Roster mã @ hiệu lực tại dòng `cueId` — CODE chọn giai đoạn, AI chỉ gọi mã. */
const buildImageRoster = (chars: EdoCharacter[], cueId: number): string =>
    chars.map(c => {
        const ma = maTaiDong(c, cueId);
        const tt = tomTatTaiDong(c, cueId);
        if (!ma) return `- [NO CODE] ${c.ten} (${c.vai}) — describe inline as: "${tt || (c.laNhom ? 'a small group of village folk' : 'a swaddled newborn baby')}"`;
        return `- @${ma} = ${c.ten}, ${c.vai}${tt ? ` — ${tt}` : ''}`;
    }).join('\n');

/** Map sang CharacterProfile để bảng "Nhân vật" cũ trong UI vẫn hiển thị được. */
const edoToProfiles = (chars: EdoCharacter[]): CharacterProfile[] =>
    chars.flatMap((c, ci) => c.giaiDoan.map((g, gi) => ({
        id: `edo-${ci}-${gi}`,
        name: g.ma ? `@${g.ma}` : `${c.ten} (không vẽ)`,
        description: [c.vai, g.moc && `từ dòng ${g.tuDong}: ${g.moc}`, g.tomTat].filter(Boolean).join(' · '),
    })));

/**
 * Chia lô KHÔNG vắt qua mốc biến đổi nhân vật — mọi dòng trong một lô dùng chung
 * một roster (cùng cơ chế tab Veo3: lô nào cũng nằm gọn trong một giai đoạn).
 */
const chunkByStage = <T extends { id: number }>(items: T[], chunkSize: number, chars: EdoCharacter[]): T[][] => {
    const boundaries = [...new Set(chars.flatMap(c => c.giaiDoan.map(g => g.tuDong)).filter(t => t > 1))].sort((a, b) => a - b);
    const stageKey = (id: number) => boundaries.filter(b => b <= id).length;
    const chunks: T[][] = [];
    let cur: T[] = [];
    for (const it of items) {
        if (cur.length >= chunkSize || (cur.length > 0 && stageKey(cur[0].id) !== stageKey(it.id))) {
            chunks.push(cur);
            cur = [];
        }
        cur.push(it);
    }
    if (cur.length) chunks.push(cur);
    return chunks;
};

/** 2 sheet Excel "Tạo hình" + "Nhân vật" — cột y hệt tab 4. Edo @ để tool ngoài đọc chung. */
type PromptLogKind = 'info' | 'ok' | 'err';

const promptNoteKind = (msg: string): PromptLogKind => {
    if (/❌|⚠️|🧩|\[LỖI\]|⏹|tách đôi|không có prompt|thiếu prompt|json hỏng|parse fail|lệch|lỗi/i.test(msg)) return 'err';
    if (/✅|✨/.test(msg)) return 'ok';
    return 'info';
};

/** Nhãn ngắn cho lý do tách lô. Dòng log vẫn kèm nguyên văn `reason`. */
const splitReasonLabel = (reason: string): string => {
    const r = reason.toLowerCase();
    if (/trả\s+\d+\s*\/\s*\d+/.test(r) || r.includes('lệch số') || r.includes('prompt rỗng') || r.includes('thiếu prompt')) return 'lệch số';
    if (/unexpected end|unterminated|end of json|cụt|truncated/.test(r)) return 'JSON cụt';
    if (/json|unexpected token|expected |parse|syntax|modeljson/.test(r)) return 'parse fail';
    return 'lỗi API';
};

const buildTaoHinhSheets = (chars: EdoCharacter[]) => ({
    taoHinhRows: chars.flatMap(c => c.giaiDoan.map(g => ({
        'Mã @': g.ma ? `@${g.ma}` : '(không cần vẽ)',
        'Nhân vật': c.ten,
        'Vai': c.vai,
        'Nhóm': c.laNhom ? 'x' : '',
        'Từ dòng': g.tuDong,
        'Giai đoạn': g.moc,
        'Tóm tắt': g.tomTat,
        'Prompt tạo hình': g.promptTaoHinh,
    }))),
    nhanVatRows: chars.map(c => ({
        'Nhân vật': c.ten,
        'Vai': c.vai,
        'Nhóm': c.laNhom ? 'x' : '',
        'Nét mặt bất biến (faceDNA)': c.faceDna,
        'Các mã @': c.giaiDoan.filter(g => !!g.ma).map(g => `@${g.ma}`).join(' · '),
    })),
});

const App: React.FC = () => {
    // --- LOGIN STATE ---
    const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
    const [currentUser, setCurrentUser] = useState<string>('');
    const [userTokenUsed, setUserTokenUsed] = useState<number>(0); // Tổng token đã dùng (từ Sheet)
    const [sessionTokenUsed, setSessionTokenUsed] = useState<number>(0); // Token dùng trong session này

    // --- MODE STATE ---
    const [activeTab, setActiveTab] = useState<TabId>('prompt');
    const [showEndpointSettings, setShowEndpointSettings] = useState<boolean>(false);

    // --- SHARED STATE ---
    const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);

    // --- IMAGE GEN STATE (Main Story) ---
    const [imageJobs, setImageJobs] = useState<ImageJob[]>([]);

    // --- BATCH IMAGE STATE ---
    const [batchProjectName, setBatchProjectName] = useState<string>('');
    const [batchProjects, setBatchProjects] = useState<BatchImageProject[]>([]);
    const [batchSelectedProjectId, setBatchSelectedProjectId] = useState<string | null>(null);
    const [batchReferenceImages, setBatchReferenceImages] = useState<ReferenceImage[]>([]);
    const [batchImageJobs, setBatchImageJobs] = useState<ImageJob[]>([]);
    const [batchCharacterJobs, setBatchCharacterJobs] = useState<ImageJob[]>([]);
    const [batchOutputFolder, setBatchOutputFolder] = useState<string | null>(null);
    const [batchCurrentRunOutputFolder, setBatchCurrentRunOutputFolder] = useState<string | null>(null);
    const [batchRunRequestId, setBatchRunRequestId] = useState<number>(0);
    const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
    const [batchStatus, setBatchStatus] = useState<string>('');
    const [batchRunningProjectId, setBatchRunningProjectId] = useState<string | null>(null);
    const batchRunResolverRef = useRef<((summary: { total: number; completed: number; failed: number; stopped: boolean }) => void) | null>(null);
    const batchLatestJobsRef = useRef<ImageJob[]>([]);
    const batchLatestRefsRef = useRef<ReferenceImage[]>([]);

    // --- CHARACTER GEN STATE (Separated) ---
    const [characterJobs, setCharacterJobs] = useState<ImageJob[]>([]);

    // --- VEO3 PROMPT GEN STATE (cùng layout với tab Tạo Prompts ảnh) ---
    const [veo3PromptFiles, setVeo3PromptFiles] = useState<File[]>([]);
    const [veo3RawSubtitles, setVeo3RawSubtitles] = useState<SubtitleItem[]>([]);
    const [veo3StyleSuffix, setVeo3StyleSuffix] = useState<string>(
        'Cinematic video, smooth camera motion, natural lighting, cohesive shot sequence. ("No text on screen, clean footage, no subtitles, no watermark")'
    );
    const [veo3CustomInstructions, setVeo3CustomInstructions] = useState<string>(
        'Each line must become a Veo-ready video prompt: motion, camera, mood, and setting. Avoid policy-violating words like: shock, horror, gloomy, terrible, negative, terrified, extremely dreadful'
    );
    const [veo3Characters, setVeo3Characters] = useState<CharacterProfile[]>([]);
    const [veo3Results, setVeo3Results] = useState<PromptResult[]>([]);
    const [veo3TokenUsage, setVeo3TokenUsage] = useState<TokenUsage>({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    const [veo3IsLoading, setVeo3IsLoading] = useState<boolean>(false);
    const [veo3Error, setVeo3Error] = useState<string | null>(null);
    const [veo3Status, setVeo3Status] = useState<string>('');
    const [veoPrefillForVeoQueue, setVeoPrefillForVeoQueue] = useState<string[] | null>(null);

    // --- PROMPT GEN STATE ---
    const [files, setFiles] = useState<File[]>([]);
    const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
    
    // RAW Subtitles Data
    const [rawSubtitles, setRawSubtitles] = useState<SubtitleItem[]>([]);

    const [styleSuffix, setStyleSuffix] = useState<string>('Edo-period animated scene with bold black outlines, flat colors. ("No textless, clean art, clean image, no text, no subtitles, no watermark") No white background, contextual background');
    const [customInstructions, setCustomInstructions] = useState<string>('The prompts image must have emotion, context, action, and impression. Avoid policy-violating words like: shock, horror, gloomy, terrible, negative, terrified, extremely dreadful');
    const [promptTextModel, setPromptTextModel] = useState<PromptTextModelId>(DEFAULT_PROMPT_TEXT_MODEL);
    
    // NEW STATE: Auto Scene Split
    const [useAutoSplit, setUseAutoSplit] = useState<boolean>(false);
    const [useAiSceneGrouping, setUseAiSceneGrouping] = useState<boolean>(true);

    const [characters, setCharacters] = useState<CharacterProfile[]>([]);
    // Nhân vật theo GIAI ĐOẠN + faceDNA (cơ chế tab 4. Edo @) — nguồn chân lý cho
    // roster mã @ và 2 sheet Excel "Tạo hình"/"Nhân vật"; `characters` cũ chỉ để hiển thị.
    const [edoChars, setEdoChars] = useState<EdoCharacter[]>([]);
    // Hậu tố style TẠO HÌNH nhân vật (nối vào prompt vẽ ảnh nền trắng) — giống tab Veo3.
    const [imageCharStyle, setImageCharStyle] = useState<string>(EDO_CHAR_STYLE);
    // Khôi phục bảng kết quả từ backup (sống sót qua reload/crash — kết quả chỉ nằm RAM
    // cho tới khi export Excel cuối file, mất điện/reload giữa chừng là mất trắng)
    const [results, setResults] = useState<PromptResult[]>(() => {
        try {
            const saved = localStorage.getItem('promptResultsBackup');
            if (saved) {
                const parsed = JSON.parse(saved) as PromptResult[];
                if (Array.isArray(parsed) && parsed.some(r => r.prompt && r.prompt.trim())) return parsed;
            }
        } catch { /* backup hỏng → bỏ qua */ }
        return [];
    });

    // Tự lưu bảng kết quả sau mỗi thay đổi — chỉ ghi đè khi có ít nhất 1 prompt
    // (không phá backup cũ bằng bảng trống lúc mới nạp file)
    useEffect(() => {
        try {
            if (results.length > 0 && results.some(r => r.prompt && r.prompt.trim())) {
                localStorage.setItem('promptResultsBackup', JSON.stringify(results));
            }
        } catch { /* localStorage đầy → bỏ qua */ }
    }, [results]);

    // File nguồn của bảng kết quả hiện tại (tên|size) — để lần chạy sau biết
    // "cùng file → tiếp tục trên bảng, KHÔNG parse/gom lại" (AI gom mỗi lần mỗi
    // khác → parse lại là mất sạch prompt cũ)
    const [resultsFileKey, setResultsFileKey] = useState<string | null>(() => {
        try { return localStorage.getItem('promptResultsFileKey'); } catch { return null; }
    });
    useEffect(() => {
        try {
            if (resultsFileKey) localStorage.setItem('promptResultsFileKey', resultsFileKey);
        } catch { /* bỏ qua */ }
    }, [resultsFileKey]);
    const [tokenUsage, setTokenUsage] = useState<TokenUsage>({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string>('');
    // Nhật ký tab Prompts 1 — không xóa khi một lô fail hay khi status bar tự tắt.
    const [promptLogs, setPromptLogs] = useState<{ t: string; msg: string; kind: PromptLogKind }[]>([]);
    const promptLogBoxRef = useRef<HTMLDivElement | null>(null);
    const promptLog = useCallback((msg: string, kind?: PromptLogKind) => {
        setPromptLogs(prev => [...prev.slice(-399), {
            t: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
            msg,
            kind: kind ?? promptNoteKind(msg),
        }]);
    }, []);
    const logStatus = useCallback((msg: string, kind?: PromptLogKind) => {
        setStatus(msg);
        promptLog(msg, kind);
    }, [promptLog]);
    useEffect(() => {
        const el = promptLogBoxRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [promptLogs]);
    // Đã bấm chạy cho file hiện tại chưa — nút "Thử lại" CHỈ hiện sau khi đã chạy xong
    // mà vẫn còn dòng lỗi (file mới nạp toàn dòng trống, không phải "lỗi").
    const [hasRunPrompts, setHasRunPrompts] = useState<boolean>(false);
    // Bộ điều khiển DỪNG HẲN riêng của tab Tạo Prompts — không ảnh hưởng các tab khác.
    const promptAbortRef = useRef<AbortController | null>(null);

    // --- PROMPT GEN 2 STATE (standalone scenes, no character analysis) ---
    const [prompt2Files, setPrompt2Files] = useState<File[]>([]);
    const [prompt2SelectedFolder, setPrompt2SelectedFolder] = useState<string | null>(null);
    const [prompt2RawSubtitles, setPrompt2RawSubtitles] = useState<SubtitleItem[]>([]);
    const [prompt2StyleSuffix, setPrompt2StyleSuffix] = useState<string>('Cinematic historical documentary concept art, detailed environmental composition, realistic scale, dramatic natural lighting, rich atmosphere, high detail. ("No text, no subtitles, no watermark")');
    const [prompt2CustomInstructions, setPrompt2CustomInstructions] = useState<string>('Create standalone image prompts for history, universe, religion, mythology, civilizations, sacred places, and explanatory scenes. Do not maintain character continuity. Focus on detailed visual composition, setting, camera, lighting, foreground, midground, background, objects, symbols, and atmosphere.');
    const [prompt2UseAutoSplit, setPrompt2UseAutoSplit] = useState<boolean>(true);
    const [prompt2UseAiSceneGrouping, setPrompt2UseAiSceneGrouping] = useState<boolean>(false);
    const [prompt2Results, setPrompt2Results] = useState<PromptResult[]>([]);
    const [prompt2TokenUsage, setPrompt2TokenUsage] = useState<TokenUsage>({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    const [prompt2IsLoading, setPrompt2IsLoading] = useState<boolean>(false);
    const [prompt2Error, setPrompt2Error] = useState<string | null>(null);
    const [prompt2Status, setPrompt2Status] = useState<string>('');
    // Đã chạy Prompts 2 cho file hiện tại chưa — gate nút "Thử lại" như tab 1.
    const [prompt2HasRun, setPrompt2HasRun] = useState<boolean>(false);
    // Bộ điều khiển DỪNG HẲN riêng của tab Tạo Prompts 2.
    const prompt2AbortRef = useRef<AbortController | null>(null);

    const apiProvider = 'gemini' as const; // Vertex-only (no API keys / no OpenAI)
    // Vertex-only: trạng thái cấu hình JSON (Electron main process)
    const [vertexStatus, setVertexStatus] = useState<{ configured: boolean } | null>(null);
    const openaiApiKey = '';
    const geminiApiKey = '';
    const useGoogleSheet = false;
    const apiKeyManager = null as any;
    const isLoadingSheet = false;
    const GOOGLE_SHEET_URL = '';
    const GOOGLE_SCRIPT_URL = '';
    const getGeminiKeys = useCallback(() => [], []);
    const handleSetGeminiApiKey = () => {};
    const setApiProvider = () => {};

    const addUsage = (usage: TokenUsage, promptCount: number = 0) => {
        setTokenUsage(prev => ({
            inputTokens: prev.inputTokens + usage.inputTokens,
            outputTokens: prev.outputTokens + usage.outputTokens,
            totalTokens: prev.totalTokens + usage.totalTokens
        }));
        
        // Track token used: 1 prompt = 1 token (accumulate, update tức thì)
        const tokensUsed = promptCount;
        setSessionTokenUsed(prev => prev + tokensUsed);
        setUserTokenUsed(prev => {
            const newTotal = prev + tokensUsed;
            // Lưu ngay vào localStorage (tức thì)
            localStorage.setItem('userTokenUsed', newTotal.toString());
            if (currentUser) {
                localStorage.setItem(`${currentUser}_tokenUsed`, newTotal.toString());
            }
            return newTotal;
        });
    };

    const addPrompt2Usage = (usage: TokenUsage, promptCount: number = 0) => {
        setPrompt2TokenUsage(prev => ({
            inputTokens: prev.inputTokens + usage.inputTokens,
            outputTokens: prev.outputTokens + usage.outputTokens,
            totalTokens: prev.totalTokens + usage.totalTokens
        }));

        const tokensUsed = promptCount;
        setSessionTokenUsed(prev => prev + tokensUsed);
        setUserTokenUsed(prev => {
            const newTotal = prev + tokensUsed;
            localStorage.setItem('userTokenUsed', newTotal.toString());
            if (currentUser) {
                localStorage.setItem(`${currentUser}_tokenUsed`, newTotal.toString());
            }
            return newTotal;
        });
    };

    const addIsekaiPromptCount = useCallback((promptCount: number) => {
        setSessionTokenUsed(prev => prev + promptCount);
        setUserTokenUsed(prev => {
            const newTotal = prev + promptCount;
            localStorage.setItem('userTokenUsed', newTotal.toString());
            if (currentUser) {
                localStorage.setItem(`${currentUser}_tokenUsed`, newTotal.toString());
            }
            return newTotal;
        });
    }, [currentUser]);

    const handleIsekaiTransferCharacterJobs = useCallback((jobs: ImageJob[]) => {
        setCharacterJobs(prev => [...prev, ...jobs]);
        setActiveTab('image');
    }, []);

    const addVeo3Usage = (usage: TokenUsage, promptCount: number = 0) => {
        setVeo3TokenUsage(prev => ({
            inputTokens: prev.inputTokens + usage.inputTokens,
            outputTokens: prev.outputTokens + usage.outputTokens,
            totalTokens: prev.totalTokens + usage.totalTokens
        }));
        const tokensUsed = promptCount;
        setSessionTokenUsed(prev => prev + tokensUsed);
        setUserTokenUsed(prev => {
            const newTotal = prev + tokensUsed;
            localStorage.setItem('userTokenUsed', newTotal.toString());
            if (currentUser) {
                localStorage.setItem(`${currentUser}_tokenUsed`, newTotal.toString());
            }
            return newTotal;
        });
    };

    // Login handler
    const handleLogin = useCallback(async (username: string, tokenUsedFromSheet: number) => {
        setIsLoggedIn(true);
        setCurrentUser(username);
        setUserTokenUsed(tokenUsedFromSheet); // Load từ Sheet
        setSessionTokenUsed(0); // Reset session
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('currentUser', username);
        localStorage.setItem('userTokenUsed', tokenUsedFromSheet.toString());
        console.log(`✅ User logged in: ${username}, Số $ đã kiếm được: ${tokenUsedFromSheet}`);

        if (typeof window !== 'undefined' && (window as any).electronAPI?.vertexRefreshCredentials) {
            try {
                const result = await (window as any).electronAPI.vertexRefreshCredentials();
                setVertexStatus({ configured: (result?.count ?? 0) > 0 });
                console.log(`[Vertex] Refresh sau login: ${result?.count ?? 0} credential (${result?.source ?? 'none'})`);
            } catch (e) {
                console.warn('[Vertex] Refresh sau login thất bại:', e);
            }
        }
    }, []);

    // Logout handler (sync token về Sheet trước khi logout)
    const handleLogout = useCallback(async () => {
        console.log(`👋 User ${currentUser} logging out...`);
        console.log(`   Session token used: ${sessionTokenUsed}`);
        console.log(`   Total token used: ${userTokenUsed}`);
        
        // 🔄 SYNC TOKEN VỀ SHEET
        if (currentUser && userTokenUsed > 0) {
            console.log('🔄 Syncing token to Sheet before logout...');
            try {
                const success = await updateUserToken(currentUser, userTokenUsed);
                if (success) {
                    console.log('✅ Token synced successfully');
                } else {
                    console.warn('⚠️ Token sync failed (Sheet may not be updated)');
                }
            } catch (error) {
                console.error('❌ Error syncing token:', error);
            }
        }
        
        setIsLoggedIn(false);
        setCurrentUser('');
        setUserTokenUsed(0);
        setSessionTokenUsed(0);
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('currentUser');
        // ⚠️ GIỮ userTokenUsed trong localStorage để lần sau login vẫn còn
        // localStorage.removeItem('userTokenUsed');
        console.log('✅ User logged out');
    }, [currentUser, sessionTokenUsed, userTokenUsed]);

    // ❌ BỎ Auto-login - Phải login lại mỗi lần mở app
    const handlePrompt2Generate = useCallback(async () => {
        if (prompt2Files.length === 0) {
            setPrompt2Error('Không có file nào để xử lý.');
            return;
        }

        try {
            ensureVertexConfigured();
        } catch (e) {
            setPrompt2Error(e instanceof Error ? e.message : String(e));
            return;
        }

        setPrompt2IsLoading(true);
        setPrompt2Error(null);
        // Bộ dừng riêng của tab Tạo Prompts 2 — không ảnh hưởng tab khác.
        const controller = new AbortController();
        prompt2AbortRef.current = controller;
        const signal = controller.signal;

        try {
            for (let fileIdx = 0; fileIdx < prompt2Files.length; fileIdx++) {
                if (signal.aborted) break;
                const file = prompt2Files[fileIdx];
                setPrompt2Status(`[File ${fileIdx + 1}/${prompt2Files.length}] Đang đọc file: ${file.name}...`);

                const text = await file.text();
                let fileItems = parseFile(file.name, text);

                const hasTime = fileItems.some(i => i.endTime > 0);
                if (hasTime && prompt2UseAiSceneGrouping) {
                    try {
                        setPrompt2Status(`[File ${fileIdx + 1}/${prompt2Files.length}] AI đang gom ngữ cảnh SRT...`);
                        const grouped = await groupSubtitlesWithAi(fileItems, signal);
                        addPrompt2Usage(grouped.usage, 0);
                        fileItems = grouped.items;
                        setPrompt2Status(`AI đã gom còn ${fileItems.length} cảnh, giữ mốc SRT gốc và giới hạn <=25s/cảnh.`);
                    } catch (e) {
                        if (isStopError(e) || signal.aborted) throw e; // Dừng → thoát hẳn
                        console.warn(`[File ${file.name}] AI scene grouping failed, fallback algorithm:`, e);
                        setPrompt2Status('AI gom ngữ cảnh lỗi, chuyển sang thuật toán gộp hiện tại...');
                        fileItems = mergeSubtitlesIntoScenes(fileItems);
                    }
                } else if (prompt2UseAutoSplit && hasTime) {
                    fileItems = mergeSubtitlesIntoScenes(fileItems);
                }

                setPrompt2Results(fileItems.map(item => ({
                    id: item.id,
                    timeRange: item.timeString,
                    subtitle: item.text,
                    prompt: ''
                })));
                await new Promise(r => setTimeout(r, 500));

                const allSubtitles = fileItems.map(r => r.text);
                const CHUNK_SIZE = 50;
                const chunks: string[][] = [];
                for (let i = 0; i < allSubtitles.length; i += CHUNK_SIZE) {
                    chunks.push(allSubtitles.slice(i, i + CHUNK_SIZE));
                }

                let generatedPromptsMap: { [id: number]: string } = {};

                for (let i = 0; i < chunks.length; i++) {
                    if (signal.aborted) break; // Dừng → không chạy lô kế tiếp
                    const currentChunkIndex = i * CHUNK_SIZE;
                    if (i > 0) {
                        setPrompt2Status(`Dang xu ly phan ${i + 1}/${chunks.length} cua file ${file.name}...`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }

                    const onPromptRetry: OnRetryCallback = ({ waitSeconds }) => {
                        setPrompt2Status(`Loi xu ly phan ${i + 1} cua ${file.name}. Thu lai sau ${waitSeconds}s...`);
                    };

                    setPrompt2Status(`Dang tao Prompts 2... (phan ${i + 1}/${chunks.length} cua ${file.name})`);
                    const response = await withRetry(
                        () => generateStandaloneImagePromptsForLines(chunks[i], apiProvider, '', prompt2CustomInstructions, signal),
                        3,
                        onPromptRetry,
                        signal
                    );

                    const chunkPrompts = response.data;
                    addPrompt2Usage(response.usage, chunkPrompts.length);

                    if (chunkPrompts && chunkPrompts.length === chunks[i].length) {
                        chunkPrompts.forEach((promptBody, idx) => {
                            const originalIndex = currentChunkIndex + idx;
                            const resultId = fileItems[originalIndex].id;
                            generatedPromptsMap[resultId] = `${resultId}_${promptBody}, ${prompt2StyleSuffix}`;
                        });

                        setPrompt2Results(prev => prev.map(item => {
                            if (generatedPromptsMap[item.id]) return { ...item, prompt: generatedPromptsMap[item.id] };
                            return item;
                        }));
                    }
                }

                if (chunks.length > 0) {
                    const finalExportData: PromptResult[] = fileItems.map(item => ({
                        id: item.id,
                        timeRange: item.timeString,
                        subtitle: item.text,
                        prompt: generatedPromptsMap[item.id] || ''
                    }));

                    const baseName = file.name.replace(/\.[^/.]+$/, "");
                    const fileName = `${baseName}_prompts_2.xlsx`;
                    await exportToExcel(finalExportData, fileName, prompt2SelectedFolder, file.name);
                }
            }

            if (currentUser && userTokenUsed > 0) {
                try {
                    await updateUserToken(currentUser, userTokenUsed);
                } catch (error) {
                    console.error('Error syncing token:', error);
                }
            }

            setPrompt2Status(signal.aborted
                ? '⏹ Đã dừng theo yêu cầu — prompt tạo xong vẫn giữ trên bảng.'
                : '✨ Hoàn tất tạo Prompts 2!');
        } catch (e) {
            if (isStopError(e) || signal.aborted) {
                setPrompt2Status('⏹ Đã dừng theo yêu cầu — prompt tạo xong vẫn giữ trên bảng.');
            } else {
                console.error(e);
                setPrompt2Error(`Quá trình thất bại: ${e instanceof Error ? e.message : 'Lỗi không xác định'}`);
            }
        } finally {
            prompt2AbortRef.current = null;
            setPrompt2HasRun(true);
            setPrompt2IsLoading(false);
            setTimeout(() => setPrompt2Status(''), 8000);
        }
    }, [prompt2Files, prompt2StyleSuffix, apiProvider, prompt2CustomInstructions, prompt2UseAutoSplit, prompt2UseAiSceneGrouping, currentUser, userTokenUsed, prompt2SelectedFolder, vertexStatus]);

    // Dừng HẲN tab Tạo Prompts 2 — không ảnh hưởng tab khác.
    const handleStopPrompt2 = useCallback(() => {
        prompt2AbortRef.current?.abort();
        setPrompt2Status('⏹ Đang dừng — hủy request đang chạy…');
    }, []);

    const handlePrompt2Retry = useCallback(async () => {
        const failedItems = prompt2Results.filter(r => !r.prompt || r.prompt.trim() === '');
        if (failedItems.length === 0) return;

        setPrompt2IsLoading(true);
        setPrompt2Error(null);
        const controller = new AbortController();
        prompt2AbortRef.current = controller;
        const signal = controller.signal;
        setPrompt2Status('Dang doi 5s truoc khi thu lai...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        try {
            const CHUNK_SIZE = 20;
            const chunks: PromptResult[][] = [];
            for (let i = 0; i < failedItems.length; i += CHUNK_SIZE) chunks.push(failedItems.slice(i, i + CHUNK_SIZE));

            let generatedPromptsMap: { [id: number]: string } = {};
            for (let i = 0; i < chunks.length; i++) {
                if (signal.aborted) break;
                const currentChunk = chunks[i];
                const subtitles = currentChunk.map(item => item.subtitle);
                setPrompt2Status(`Dang thu lai phan ${i + 1}/${chunks.length}...`);

                const response = await withRetry(
                    () => generateStandaloneImagePromptsForLines(subtitles, apiProvider, '', prompt2CustomInstructions, signal),
                    3,
                    undefined,
                    signal
                );
                const chunkPrompts = response.data;
                addPrompt2Usage(response.usage, chunkPrompts.length);

                if (chunkPrompts && chunkPrompts.length === subtitles.length) {
                    chunkPrompts.forEach((promptBody, idx) => {
                        const originalItem = currentChunk[idx];
                        generatedPromptsMap[originalItem.id] = `${originalItem.id}_${promptBody}, ${prompt2StyleSuffix}`;
                    });
                    setPrompt2Results(prev => prev.map(item => {
                        if (generatedPromptsMap[item.id]) return { ...item, prompt: generatedPromptsMap[item.id] };
                        return item;
                    }));
                }

                if (i < chunks.length - 1) await new Promise(resolve => setTimeout(resolve, 2000));
            }

            setPrompt2Status(signal.aborted ? '⏹ Đã dừng thử lại theo yêu cầu.' : 'Da thu lai xong Prompts 2!');
        } catch (e) {
            if (isStopError(e) || signal.aborted) {
                setPrompt2Status('⏹ Đã dừng thử lại theo yêu cầu.');
            } else {
                setPrompt2Error(e instanceof Error ? e.message : 'Loi khi thu lai Prompts 2.');
            }
        } finally {
            prompt2AbortRef.current = null;
            setPrompt2IsLoading(false);
            setTimeout(() => setPrompt2Status(''), 5000);
        }
    }, [prompt2Results, prompt2StyleSuffix, apiProvider, prompt2CustomInstructions]);

    const handlePrompt2Download = async () => {
        if (prompt2Results.some(r => r.prompt)) {
            if (!prompt2SelectedFolder && typeof window !== 'undefined' && (window as any).electronAPI) {
                try {
                    const folderPath = await (window as any).electronAPI.selectFolder();
                    if (folderPath) {
                        setPrompt2SelectedFolder(folderPath);
                        let fileName = 'generated_prompts_2.xlsx';
                        let inputFileName = '';
                        if (prompt2Files.length > 0) {
                            const baseName = prompt2Files[0].name.replace(/\.[^/.]+$/, "");
                            fileName = `${baseName}_prompts_2.xlsx`;
                            inputFileName = prompt2Files[0].name;
                        }
                        await exportToExcel(prompt2Results, fileName, folderPath, inputFileName);
                    }
                } catch (error) {
                    console.error('Error selecting folder:', error);
                    setPrompt2Error('Loi khi chon thu muc. Vui long thu lai.');
                }
            } else {
                let fileName = 'generated_prompts_2.xlsx';
                let inputFileName = '';
                if (prompt2Files.length > 0) {
                    const baseName = prompt2Files[0].name.replace(/\.[^/.]+$/, "");
                    fileName = `${baseName}_prompts_2.xlsx`;
                    inputFileName = prompt2Files[0].name;
                }
                await exportToExcel(prompt2Results, fileName, prompt2SelectedFolder, inputFileName);
            }
        } else {
            setPrompt2Error('Chua co prompt nao de xuat.');
        }
    };

    const handlePrompt2TransferToImageGen = () => {
        const generatedItems = prompt2Results.filter(r => r.prompt && r.prompt.trim() !== '');

        if (generatedItems.length === 0) {
            setPrompt2Error('Chua co prompt nao de chuyen.');
            return;
        }

        const newJobs: ImageJob[] = generatedItems.map((item, index) => ({
            id: `prompt2-transfer-${Date.now()}-${index}`,
            prompt: item.prompt,
            status: 'pending'
        }));

        setImageJobs(newJobs);
        if (prompt2SelectedFolder) {
            setSelectedFolder(prompt2SelectedFolder);
        }
        setActiveTab('image');
        setPrompt2Status(`Da chuyen ${newJobs.length} prompt sang tab Tao Anh AI.`);
        setTimeout(() => setPrompt2Status(''), 3000);
    };

    useEffect(() => {
        // Clear login state khi mở app
        localStorage.removeItem('isLoggedIn');
        console.log('🔓 App started - Login required');
    }, []);

    // ❌ BỎ periodic sync - Chỉ lưu localStorage, update tức thì
    
    // 🔄 SYNC TOKEN KHI TẮT APP (beforeunload)
    useEffect(() => {
        const handleBeforeUnload = async (e: BeforeUnloadEvent) => {
            if (currentUser && userTokenUsed > 0) {
                console.log('🔄 App closing - Syncing token to Sheet...');
                
                // Sync token về Sheet
                try {
                    await updateUserToken(currentUser, userTokenUsed);
                    console.log('✅ Token synced successfully');
                } catch (error) {
                    console.error('❌ Error syncing token:', error);
                }
                
                // Clear login để phải login lại lần sau
                localStorage.removeItem('isLoggedIn');
                console.log('🔓 Login cleared - Will require login next time');
            }
        };
        
        window.addEventListener('beforeunload', handleBeforeUnload);
        
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [currentUser, userTokenUsed]);

    useEffect(() => {
        const loadFiles = async () => {
            if (files.length === 0) return;

            const file = files[0];
            const fileKey = `${file.name}|${file.size}`;
            const rowsToRaw = (rows: PromptResult[]): SubtitleItem[] =>
                rows.map(r => ({ id: r.id, text: r.subtitle, timeString: r.timeRange || '', startTime: 0, endTime: 0 }));

            // CÙNG FILE với bảng hiện tại → KHÔNG xóa gì. (Trước đây chọn lại đúng file cũ
            // hay đổi toggle là bảng bị xóa trắng → mất điều kiện resume → lần chạy sau
            // AI gom lại từ đầu, dòng lệch hết → "chạy lại từ đầu, mất dữ liệu".)
            if (fileKey === resultsFileKey) {
                if (results.some(r => r.prompt && r.prompt.trim())) {
                    setRawSubtitles(rowsToRaw(results));
                    setError(null);
                    setStatus('♻️ Cùng file cũ — giữ nguyên bảng kết quả, bấm chạy sẽ chỉ bù dòng trống.');
                    setTimeout(() => setStatus(''), 6000);
                    return;
                }
                // Bảng trống (vd vừa F5/mở lại app) nhưng backup trong máy là của ĐÚNG file này → khôi phục.
                try {
                    const saved = localStorage.getItem('promptResultsBackup');
                    if (saved) {
                        const parsed = JSON.parse(saved) as PromptResult[];
                        if (Array.isArray(parsed) && parsed.some(r => r.prompt && r.prompt.trim())) {
                            setResults(parsed);
                            setRawSubtitles(rowsToRaw(parsed));
                            setError(null);
                            setStatus('♻️ Đã khôi phục bảng kết quả từ backup — bấm chạy sẽ chỉ bù dòng trống.');
                            setTimeout(() => setStatus(''), 6000);
                            return;
                        }
                    }
                } catch (e) {
                    const em = e instanceof Error ? e.message : String(e);
                    promptLog(`⚠️ Backup kết quả hỏng, đọc lại file. ${em}`, 'err');
                }
            }

            // FILE MỚI thật sự → reset bảng như cũ (bài trước đã tự xuất Excel khi chạy xong)
            setCharacters([]);
            setEdoChars([]);
            setTokenUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
            setRawSubtitles([]);
            setResults([]);
            setHasRunPrompts(false); // file mới chưa chạy — dòng trống KHÔNG phải lỗi, chưa hiện Thử lại
            try {
                const text = await file.text();
                let allItems = parseFile(file.name, text);

                // Gộp dòng ngay khi preview (nếu bật Auto Split và file có timecode)
                if (useAutoSplit) {
                    const hasTime = allItems.some(i => i.endTime > 0);
                    if (hasTime) {
                        allItems = mergeSubtitlesIntoScenes(allItems);
                    }
                }

                setRawSubtitles(allItems);

                // Initial UI population (Raw mapping)
                const initialResults = allItems.map(item => ({
                    id: item.id,
                    timeRange: item.timeString,
                    subtitle: item.text,
                    prompt: ''
                }));

                setResults(initialResults);
                setError(null);
            } catch (e) {
                const em = e instanceof Error ? e.message : String(e);
                console.error(e);
                setError(`Lỗi khi đọc file: ${em}`);
                promptLog(`❌ Lỗi khi đọc file: ${em}`, 'err');
            }
        };
        if (files.length > 0) {
             loadFiles();
        }
    }, [files, useAutoSplit]);

    useEffect(() => {
        const loadPrompt2Files = async () => {
            if (prompt2Files.length === 0) {
                setPrompt2RawSubtitles([]);
                setPrompt2Results([]);
                return;
            }

            setPrompt2TokenUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
            setPrompt2RawSubtitles([]);
            setPrompt2Results([]);
            setPrompt2HasRun(false); // file mới chưa chạy — không hiện Thử lại
            try {
                let allItems: SubtitleItem[] = [];

                if (prompt2Files.length > 0) {
                    const file = prompt2Files[0];
                    const text = await file.text();
                    allItems = parseFile(file.name, text);
                }

                if (prompt2UseAutoSplit) {
                    const hasTime = allItems.some(i => i.endTime > 0);
                    if (hasTime) {
                        allItems = mergeSubtitlesIntoScenes(allItems);
                    }
                }

                setPrompt2RawSubtitles(allItems);
                setPrompt2Results(allItems.map(item => ({
                    id: item.id,
                    timeRange: item.timeString,
                    subtitle: item.text,
                    prompt: ''
                })));
                setPrompt2Error(null);
            } catch (e) {
                console.error(e);
                setPrompt2Error('Lỗi khi đọc file. Vui lòng kiểm tra định dạng.');
            }
        };
        if (prompt2Files.length > 0) {
            loadPrompt2Files();
        }
    }, [prompt2Files, prompt2UseAutoSplit]);

    useEffect(() => {
        const loadVeo3Files = async () => {
            if (veo3PromptFiles.length === 0) {
                setVeo3RawSubtitles([]);
                setVeo3Results([]);
                return;
            }

            setVeo3Characters([]);
            setVeo3TokenUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

            try {
                for (const file of veo3PromptFiles) {
                    if (!file.name.toLowerCase().endsWith('.srt')) {
                        setVeo3Error('Tab Prompts Veo3 chỉ chấp nhận file .srt.');
                        setVeo3RawSubtitles([]);
                        setVeo3Results([]);
                        return;
                    }
                }

                let allItems: SubtitleItem[] = [];

                if (veo3PromptFiles.length > 0) {
                    const file = veo3PromptFiles[0];
                    const text = await file.text();
                    allItems = parseFile(file.name, text);
                }

                setVeo3RawSubtitles(allItems);
                setVeo3Results(
                    allItems.map(item => ({
                        id: item.id,
                        timeRange: item.timeString || '',
                        subtitle: item.text,
                        prompt: ''
                    }))
                );
                setVeo3Error(null);
            } catch (e) {
                console.error(e);
                setVeo3Error('Lỗi khi đọc file .srt. Vui lòng kiểm tra định dạng.');
                setVeo3Results([]);
            }
        };
        loadVeo3Files();
    }, [veo3PromptFiles]);
    
    useEffect(() => {
        const run = async () => {
            if (typeof window !== 'undefined' && (window as any).electronAPI?.vertexIsConfigured) {
                const configured = await (window as any).electronAPI.vertexIsConfigured();
                setVertexStatus({ configured });
            } else {
                setVertexStatus({ configured: false });
            }
        };
        run();
    }, []);

    // --- MANUALLY ANALYZE CHARACTERS ---
    const ensureVertexConfigured = () => {
        // Có cổng LLM bên thứ 3 (⚙ Cài đặt) → chạy được ngay, không cần Vertex
        if (hasPortsConfigured()) return;
        if (!vertexStatus?.configured) {
            throw new Error('Chưa cấu hình cổng LLM (bấm nút ⚙ trên header để thêm cổng) và Vertex cũng chưa sẵn sàng.');
        }
    };

    const handleAnalyzeCharacters = useCallback(async () => {
        if (rawSubtitles.length === 0) {
            const line = 'Vui lòng tải lên nội dung kịch bản ở bước 3 trước.';
            setError(line);
            promptLog(`⚠️ ${line}`, 'err');
            return;
        }
        try {
            // API trực tiếp (tab Tạo Prompts) là đường đi riêng — không cần cổng/Vertex
            if (!isDirectApiModel(promptTextModel)) ensureVertexConfigured();
        } catch (e) {
            const em = e instanceof Error ? e.message : String(e);
            setError(em);
            promptLog(`❌ ${em}`, 'err');
            return;
        }

        setIsLoading(true);
        setError(null);
        const controller = new AbortController();
        promptAbortRef.current = controller;
        logStatus('🤖 Đang đọc kịch bản để phân tích nhân vật...', 'info');

        try {
            const cast = await resolveImageTabCast({
                items: rawSubtitles,
                model: promptTextModel,
                charStyle: imageCharStyle,
                signal: controller.signal,
                onStatus: (message) => logStatus(message),
                onNote: (message) => promptLog(message),
            });
            if (cast.usage) addUsage(cast.usage, 0);
            setEdoChars(cast.characters);
            setCharacters(edoToProfiles(cast.characters));
            const soAnh = cast.characters.reduce((s, c) => s + c.giaiDoan.filter(g => !!g.ma).length, 0);
            const thieu = cast.missingMa.length
                ? ` Thiếu prompt tạo hình: ${cast.missingMa.slice(0, 8).join(', ')}${cast.missingMa.length > 8 ? '…' : ''}.`
                : '';
            if (cast.missingMa.length) {
                promptLog(`[LỖI] Thiếu prompt tạo hình (${cast.missingMa.length}): ${cast.missingMa.join(', ')}`, 'err');
            }
            if (!cast.characters.length) {
                logStatus(`⚠️ Không tìm thấy nhân vật. ${cast.warning || ''}`.trim(), 'err');
            } else if (cast.usedLegacy) {
                logStatus(`⚠️ Đã dùng phân tích cũ (không đủ giai đoạn Edo) và vẫn viết sheet. ${cast.characters.length} nhân vật, ${soAnh} mã.${thieu}`, 'err');
            } else if (cast.missingMa.length) {
                logStatus(`⚠️ Khóa ${cast.characters.length} nhân vật (${soAnh} mã).${thieu}`, 'err');
            } else {
                logStatus(`✅ Khóa ${cast.characters.length} nhân vật (${soAnh} ảnh tạo hình).`, 'ok');
            }
        } catch (e) {
            if (isStopError(e) || controller.signal.aborted) {
                logStatus('⏹ Đã dừng phân tích nhân vật.', 'err');
            } else {
                const em = e instanceof Error ? e.message : 'Không xác định';
                console.warn("Analysis failed:", e);
                setError(`Lỗi phân tích: ${em}`);
                logStatus(`❌ Lỗi phân tích: ${em}`, 'err');
            }
        } finally {
            promptAbortRef.current = null;
            setIsLoading(false);
            setTimeout(() => {
                setStatus((prev) => prev.includes('✅') ? '' : prev);
            }, 3000);
        }
    }, [rawSubtitles, apiProvider, vertexStatus, promptTextModel, imageCharStyle, addUsage, promptLog, logStatus]);


    // --- TRANSFER CHARACTERS TO SEPARATE CHARACTER GEN PANEL ---
    const handleTransferCharacters = useCallback(() => {
        // Cơ chế mới: mỗi GIAI ĐOẠN có mã @ một job tạo hình, prompt đã đủ
        // faceDNA + style tạo hình (do generateEdoCharacterSheets nối sẵn).
        if (edoChars.length > 0) {
            const charJobs: ImageJob[] = edoChars
                .flatMap(c => c.giaiDoan.filter(g => !!g.ma && !!g.promptTaoHinh))
                .map((g, index) => ({
                    id: `char-gen-${Date.now()}-${index}`,
                    prompt: g.promptTaoHinh,
                    status: 'pending' as const,
                    isCharacterGen: true,
                    characterName: g.ma,
                    aspectRatio: '9:16' as const,
                }));
            if (!charJobs.length) {
                promptLog('⚠️ Không có prompt tạo hình nào để chuyển — các giai đoạn đang trống.', 'err');
                return;
            }
            setCharacterJobs(prev => [...prev, ...charJobs]);
            setActiveTab('image');
            logStatus(`🚀 Đã thêm ${charJobs.length} ảnh tạo hình (theo giai đoạn @) vào Bảng tạo hình.`, 'ok');
            setTimeout(() => setStatus(''), 3000);
            return;
        }

        // Fallback luồng cũ (chưa chạy phân tích giai đoạn).
        if (characters.length === 0) return;
        const CHARACTER_STYLE_PREFIX = "Edo-period animated style, bold black outlines, both front view, looking at viewer, 2/3 body shot, hands at sides, white background, masterpiece, best quality, high resolution.";
        const charJobs: ImageJob[] = characters.map((char, index) => ({
            id: `char-gen-${Date.now()}-${index}`,
            prompt: `${CHARACTER_STYLE_PREFIX} ${char.description}`,
            status: 'pending',
            isCharacterGen: true,
            characterName: char.name,
            aspectRatio: '9:16'
        }));
        setCharacterJobs(prev => [...prev, ...charJobs]);
        setActiveTab('image');
        logStatus(`🚀 Đã thêm ${charJobs.length} nhân vật vào Bảng tạo hình.`, 'ok');
        setTimeout(() => setStatus(''), 3000);
    }, [characters, edoChars, promptLog, logStatus]);


    const handleGenerate = useCallback(async () => {
        if (files.length === 0) {
            const line = 'Không có tệp nào để xử lý.';
            setError(line);
            promptLog(`⚠️ ${line}`, 'err');
            return;
        }

        setIsLoading(true);
        setError(null);
        // Mỗi lượt chạy 1 controller mới — nút Dừng abort là mọi tầng thoát ngay.
        const controller = new AbortController();
        promptAbortRef.current = controller;
        const signal = controller.signal;
        logStatus(`🚀 Bắt đầu tạo prompts — ${files.length} file.`, 'info');

        try {
            let allFinalExportData: PromptResult[] = [];
            // File nào lỗi cứng (không đọc được, ghi Excel fail…) → ghi nhận rồi CHẠY TIẾP
            // file kế — 1 file hỏng không được làm chết cả đoàn 100 bài.
            const fileErrors: string[] = [];
            for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
                if (signal.aborted) break;
                const file = files[fileIdx];
                try {
                logStatus(`[File ${fileIdx + 1}/${files.length}] Đang đọc kịch bản: ${file.name}...`, 'info');

                // --- 0. PREPARE DATA ---
                // CÙNG FILE + bảng đã có prompt → tiếp tục trên bảng hiện tại, KHÔNG
                // parse/gom lại. (AI gom ngữ cảnh mỗi lần mỗi khác → gom lại là nội dung
                // dòng đổi hết, không khớp prompt cũ → trước đây bị xóa sạch chạy lại từ đầu.)
                const fileKey = `${file.name}|${file.size}`;
                const canResumeFromTable =
                    fileKey === resultsFileKey &&
                    results.length > 0 &&
                    results.some(r => isUsableImagePrompt(r.prompt));

                let fileItems: SubtitleItem[];
                if (canResumeFromTable) {
                    fileItems = results.map(r => ({
                        id: r.id,
                        text: r.subtitle,
                        timeString: r.timeRange || '',
                        startTime: 0,
                        endTime: 0,
                    }));
                    logStatus(`▶️ Cùng file ${file.name} — tiếp tục trên bảng kết quả, chỉ chạy dòng trống...`, 'info');
                } else {
                    const text = await file.text();
                    fileItems = parseFile(file.name, text);

                    const hasTime = fileItems.some(i => i.endTime > i.startTime);
                    if (hasTime && useAiSceneGrouping) {
                        try {
                            logStatus(`[File ${fileIdx + 1}/${files.length}] AI đang gom ngữ cảnh SRT...`, 'info');
                            const grouped = await groupSubtitlesWithAi(fileItems, signal);
                            addUsage(grouped.usage, 0);
                            fileItems = grouped.items;
                            logStatus(`AI đã gom còn ${fileItems.length} cảnh, giữ mốc SRT gốc và giới hạn <=25s/cảnh.`, 'ok');
                        } catch (e) {
                            if (isStopError(e) || signal.aborted) throw e; // Dừng → thoát hẳn
                            const em = e instanceof Error ? e.message : String(e);
                            console.warn(`[File ${file.name}] AI scene grouping failed, fallback algorithm:`, e);
                            logStatus(`AI gom ngữ cảnh lỗi (${em}) — chuyển sang thuật toán gộp hiện tại...`, 'err');
                            fileItems = mergeSubtitlesIntoScenes(fileItems);
                        }
                    } else if (useAutoSplit) {
                        if (hasTime) {
                            fileItems = mergeSubtitlesIntoScenes(fileItems);
                        }
                    }
                }
                setResultsFileKey(fileKey);

                // Update UI: GIỮ prompt đã tạo trước đó (trùng id + nội dung dòng) — không xóa trắng nữa.
                // Chạy lại chỉ chạy bù những dòng còn trống.
                const reuseMap = new Map<string, string>();
                results.forEach(r => {
                    if (isUsableImagePrompt(r.prompt)) reuseMap.set(`${r.id}|${r.subtitle}`, r.prompt);
                });
                setResults(fileItems.map(item => ({
                    id: item.id,
                    timeRange: item.timeString,
                    subtitle: item.text,
                    prompt: reuseMap.get(`${item.id}|${item.text}`) || ''
                })));
                const pendingItems = fileItems.filter(item => !reuseMap.get(`${item.id}|${item.text}`));
                const reusedCount = fileItems.length - pendingItems.length;
                if (reusedCount > 0) {
                    logStatus(`♻️ Giữ lại ${reusedCount} prompt đã tạo, chỉ chạy bù ${pendingItems.length} dòng trống...`, 'info');
                }
                await new Promise(r => setTimeout(r, 800));

                // --- 1. AUTO DETECT CHARACTERS --- (bỏ qua nếu không còn dòng nào cần tạo)
                // Edo đọc cả kịch bản và tự tách lô khi JSON hỏng. Chỉ khi fail hết mới
                // dùng phân tích cũ — và lần đó vẫn cố sheet tạo hình, có báo trên status.
                let activeCharacters: CharacterProfile[] = [];
                let activeEdoChars: EdoCharacter[] = [];
                if (pendingItems.length > 0) {
                    try {
                        const fileTag = `[File ${fileIdx + 1}/${files.length}]`;
                        const cast = await resolveImageTabCast({
                            items: fileItems,
                            model: promptTextModel,
                            charStyle: imageCharStyle,
                            signal,
                            onStatus: (message) => logStatus(`${fileTag} ${message}`),
                            onNote: (message) => promptLog(`${fileTag} ${message}`),
                        });
                        if (cast.usage) addUsage(cast.usage, 0);
                        activeEdoChars = cast.characters;
                        if (activeEdoChars.length) {
                            const profiles = edoToProfiles(activeEdoChars);
                            activeCharacters = profiles;
                            setEdoChars(activeEdoChars);
                            setCharacters(profiles);
                            const soAnh = activeEdoChars.reduce((s, c) => s + c.giaiDoan.filter(g => !!g.ma).length, 0);
                            const thieu = cast.missingMa.length
                                ? ` Thiếu prompt tạo hình: ${cast.missingMa.slice(0, 8).join(', ')}${cast.missingMa.length > 8 ? '…' : ''}.`
                                : '';
                            if (cast.missingMa.length) {
                                promptLog(`${fileTag} [LỖI] Thiếu prompt tạo hình (${cast.missingMa.length}): ${cast.missingMa.join(', ')}`, 'err');
                            }
                            if (cast.usedLegacy) {
                                logStatus(`⚠️ ${fileTag} Đã dùng phân tích cũ (không đủ giai đoạn Edo) và vẫn viết sheet. ${activeEdoChars.length} nhân vật, ${soAnh} mã.${thieu}`, 'err');
                            } else if (cast.missingMa.length) {
                                logStatus(`⚠️ ${fileTag} Khóa ${activeEdoChars.length} nhân vật (${soAnh} mã).${thieu}`, 'err');
                            } else {
                                logStatus(`✅ Khóa ${activeEdoChars.length} nhân vật (${soAnh} ảnh tạo hình) trong file ${file.name}.`, 'ok');
                            }
                        } else {
                            logStatus(`⚠️ Không tìm thấy nhân vật trong file ${file.name}${cast.warning ? `: ${cast.warning}` : ''}. Tiếp tục tạo prompt...`, 'err');
                        }
                    } catch (e) {
                        if (isStopError(e) || signal.aborted) throw e;
                        const em = e instanceof Error ? e.message : String(e);
                        console.warn(`[File ${file.name}] Character analysis failed:`, e);
                        logStatus(`❌ [File ${fileIdx + 1}/${files.length}] Phân tích nhân vật lỗi: ${em}. Tiếp tục tạo prompt không khóa nhân vật.`, 'err');
                    }
                }

                // --- 2. GENERATE PROMPTS --- (chỉ những dòng chưa có prompt)
                // Lô nhỏ hơn 50 để JSON không cụt. DeepSeek vốn 10. Lệch số / JSON hỏng
                // thì tách đôi tới từng dòng — không bỏ cả lô.
                const CHUNK_SIZE = imagePromptChunkSize(getDirectApiChunkSize(promptTextModel));
                const chunks: SubtitleItem[][] = chunkByStage(pendingItems, CHUNK_SIZE, activeEdoChars);

                let generatedPromptsMap: { [id: number]: string } = {};
                fileItems.forEach(item => {
                    const kept = reuseMap.get(`${item.id}|${item.text}`);
                    if (kept) generatedPromptsMap[item.id] = kept;
                });

                const PROMPT_CONC = promptTextModel.startsWith('deepseek') ? 3 : 4;
                let doneChunks = 0;
                if (pendingItems.length > 0) {
                    logStatus(`[File ${fileIdx + 1}/${files.length}] 🚀 Đang tạo prompts (${pendingItems.length} dòng, ${chunks.length} lô, ${CHUNK_SIZE} dòng/lô)...`, 'info');
                }

                const writePromptsFor = async (chunk: SubtitleItem[], label: string): Promise<void> => {
                    if (!chunk.length || signal.aborted) return;
                    const { prompts, errors } = await recoverPromptBatch(chunk, async (slice) => {
                        return withTransientRetries(async () => {
                            const roster = activeEdoChars.length ? buildImageRoster(activeEdoChars, slice[0].id) : undefined;
                            const r = await generatePromptsForLines(slice.map(s => s.text), apiProvider, activeCharacters, '', customInstructions, promptTextModel, signal, roster);
                            addUsage(r.usage, Array.isArray(r.data) ? r.data.length : 0);
                            if (!Array.isArray(r.data)) throw new Error('Phản hồi JSON không có mảng prompt.');
                            return r.data;
                        }, {
                            attempts: 3,
                            signal,
                            isAbort: (err) => isStopError(err) || signal.aborted,
                            onRetry: (attempt, error) => {
                                const em = error instanceof Error ? error.message : String(error);
                                logStatus(`⚠️ ${label} lỗi tạm lần ${attempt}: ${em}`, 'err');
                            },
                        });
                    }, {
                        singleAttempts: 2,
                        isAbort: (err) => isStopError(err) || signal.aborted,
                        onSplit: (size, reason) => logStatus(`🧩 ${label}: tách đôi lô ${size} dòng vì ${splitReasonLabel(reason)}. ${reason}`, 'err'),
                        onKeep: (index, prompt) => {
                            const item = chunk[index];
                            const full = `${item.id}_${prompt}, ${styleSuffix}`;
                            generatedPromptsMap[item.id] = full;
                            setResults(prev => prev.map(row => row.id === item.id ? { ...row, prompt: full } : row));
                        },
                    });
                    prompts.forEach((prompt, index) => {
                        if (prompt) return;
                        const item = chunk[index];
                        const msg = errors[index] || 'không tạo được prompt';
                        const marker = formatPromptLineError(item.id, msg);
                        generatedPromptsMap[item.id] = marker;
                        console.warn(`[Prompts ảnh] Dòng ${item.id} lỗi sau mọi lần thử: ${msg}`);
                        promptLog(`[LỖI] dòng ${item.id}: ${msg.replace(/\s+/g, ' ').trim()}`, 'err');
                        setResults(prev => prev.map(row => row.id === item.id ? { ...row, prompt: marker } : row));
                    });
                };

                {
                    let nextChunk = 0;
                    const workerCount = Math.max(1, Math.min(PROMPT_CONC, chunks.length || 1));
                    await Promise.all(Array.from({ length: workerCount }, async () => {
                        while (true) {
                            const idx = nextChunk++;
                            if (idx >= chunks.length || signal.aborted) return;
                            await writePromptsFor(chunks[idx], `Lô ${idx + 1}/${chunks.length} của ${file.name}`);
                            doneChunks++;
                            setStatus(`🎨 ${file.name}: xong ${doneChunks}/${chunks.length} lô (tối đa ${PROMPT_CONC} luồng, ${CHUNK_SIZE} dòng/lô)...`);
                        }
                    }));
                }

                const missing = pendingItems.filter(it => !isUsableImagePrompt(generatedPromptsMap[it.id]));
                if (pendingItems.length === 0) {
                    logStatus(`♻️ ${file.name}: mọi dòng đã có prompt, không gọi lại model.`, 'info');
                } else {
                    logStatus(missing.length === 0
                        ? `✅ ${file.name}: đã có prompt cho đủ ${pendingItems.length} dòng.`
                        : `⚠️ ${file.name}: còn ${missing.length} dòng lỗi (${missing.slice(0, 12).map(it => it.id).join(', ')}${missing.length > 12 ? '…' : ''}). Bấm "Thử lại" để chạy lại đúng các dòng này.`);
                }

                // --- AUTO DOWNLOAD EXCEL ON SUCCESS FOR THIS FILE ---
                if (fileItems.length > 0) {
                    const finalExportData: PromptResult[] = fileItems.map(item => ({
                        id: item.id,
                        timeRange: item.timeString,
                        subtitle: item.text,
                        prompt: generatedPromptsMap[item.id] || ''
                    }));

                    let baseName = file.name.replace(/\.[^/.]+$/, "");
                    let fileName = `${baseName}_prompts.xlsx`;
                    let characterReferenceRows = [];
                    // Sheet "Tạo hình" + "Nhân vật" — cột y hệt tab 4. Edo @ (Prompts Veo3).
                    const sheets = activeEdoChars.length ? buildTaoHinhSheets(activeEdoChars) : undefined;
                    await exportToExcel(finalExportData, fileName, selectedFolder, file.name, characterReferenceRows,
                        sheets?.taoHinhRows, sheets?.nhanVatRows);
                    allFinalExportData = [...allFinalExportData, ...finalExportData];
                }
                } catch (fileErr) {
                    // Dừng theo yêu cầu → thoát hẳn cả đoàn (xử lý ở catch ngoài).
                    if (isStopError(fileErr) || signal.aborted) throw fileErr;
                    const femsg = fileErr instanceof Error ? fileErr.message : String(fileErr);
                    fileErrors.push(`${file.name} (${femsg.slice(0, 80)})`);
                    console.error(`[batch] File ${file.name} lỗi — chuyển sang file kế tiếp:`, fileErr);
                    logStatus(`❌ [File ${fileIdx + 1}/${files.length}] ${file.name} lỗi: ${femsg}`, 'err');
                }
            }

            // End of batch - Các file đã tự động tải về riêng lẻ.
            // Bảng kết quả (UI) sẽ hiện kết quả của file cuối cùng, tránh lỗi duplicate STT khi gộp.

            // 🔄 SYNC TOKEN VỀ SHEET NGAY SAU KHI HOÀN TẤT
            if (currentUser && userTokenUsed > 0) {
                console.log('🔄 Syncing token to Sheet after completion...');
                try {
                    const success = await updateUserToken(currentUser, userTokenUsed);
                    if (success) {
                        console.log('✅ Token synced successfully to Sheet');
                    } else {
                        console.warn('⚠️ Token sync failed (Sheet may not be updated)');
                    }
                } catch (error) {
                    console.error('❌ Error syncing token:', error);
                }
            }

            logStatus(signal.aborted
                ? '⏹ Đã dừng theo yêu cầu — prompt tạo xong vẫn giữ trên bảng, bấm "Thử lại" để chạy bù dòng trống.'
                : fileErrors.length > 0
                    ? `⚠️ Xong ${files.length - fileErrors.length}/${files.length} file. File lỗi: ${fileErrors.join('; ').slice(0, 300)}`
                    : '✨ Hoàn tất chạy tất cả các file!');
        } catch (e) {
            if (isStopError(e) || signal.aborted) {
                // Người dùng bấm Dừng — không phải lỗi.
                logStatus('⏹ Đã dừng theo yêu cầu — prompt tạo xong vẫn giữ trên bảng, bấm "Thử lại" để chạy bù dòng trống.', 'err');
            } else {
                const em = e instanceof Error ? e.message : 'Lỗi không xác định';
                console.error(e);
                setError(`Quá trình thất bại: ${em}`);
                logStatus(`❌ Quá trình thất bại: ${em}`, 'err');
            }
        } finally {
            promptAbortRef.current = null;
            setHasRunPrompts(true); // từ giờ dòng trống mới được tính là "lỗi" → hiện nút Thử lại
            setIsLoading(false);
            setTimeout(() => setStatus(''), 8000);
        }
    }, [files, results, resultsFileKey, styleSuffix, apiProvider, customInstructions, promptTextModel, useAutoSplit, useAiSceneGrouping, currentUser, userTokenUsed, selectedFolder, addUsage, imageCharStyle, promptLog, logStatus]);

    // Dừng HẲN tab Tạo Prompts — hủy ngay request đang bay, không ảnh hưởng tab khác.
    const handleStopGenerate = useCallback(() => {
        promptAbortRef.current?.abort();
        logStatus('⏹ Đang dừng — hủy request đang chạy…', 'err');
    }, [logStatus]);

    // Xóa kịch bản cũ: gỡ file đã nạp + bảng kết quả + nhân vật (kể cả backup) để chạy mới từ đầu.
    const handleClearOldScript = useCallback(() => {
        if (isLoading) return;
        if (!window.confirm('Xóa kịch bản cũ?\nGỡ file đã nạp, toàn bộ bảng kết quả và hồ sơ nhân vật để bắt đầu kịch bản mới.')) return;
        setFiles([]);
        setRawSubtitles([]);
        setResults([]);
        setCharacters([]);
        setEdoChars([]);
        setResultsFileKey(null);
        setHasRunPrompts(false);
        try {
            localStorage.removeItem('promptResultsBackup');
            localStorage.removeItem('promptResultsFileKey');
        } catch { /* bỏ qua */ }
        setError(null);
        logStatus('🧹 Đã xóa kịch bản cũ — nạp file mới để bắt đầu.', 'info');
        setTimeout(() => setStatus(''), 4000);
    }, [isLoading, logStatus]);
    
    const handleRetry = useCallback(async () => {
        const failedItems = results.filter(r => !isUsableImagePrompt(r.prompt));
        if (failedItems.length === 0) return;
        setIsLoading(true);
        setError(null);
        const controller = new AbortController();
        promptAbortRef.current = controller;
        const signal = controller.signal;
        logStatus(`⏳ Thử lại ${failedItems.length} dòng lỗi — đợi 5s...`, 'info');
        await new Promise(resolve => setTimeout(resolve, 5000));

        try {
            const CHUNK_SIZE = imagePromptChunkSize(getDirectApiChunkSize(promptTextModel));
            const chunks: PromptResult[][] = chunkByStage(failedItems, CHUNK_SIZE, edoChars);

            let successCount = 0;

            for (let i = 0; i < chunks.length; i++) {
                if (signal.aborted) break;
                const items = chunks[i];
                const label = `phần ${i + 1}/${chunks.length}`;
                logStatus(`🔄 Đang thử lại ${label} (${items.length} dòng)...`, 'info');
                const { prompts, errors } = await recoverPromptBatch(items, async (slice) => {
                    return withTransientRetries(async () => {
                        const roster = edoChars.length ? buildImageRoster(edoChars, slice[0].id) : undefined;
                        const r = await generatePromptsForLines(slice.map(s => s.subtitle), apiProvider, characters, '', customInstructions, promptTextModel, signal, roster);
                        addUsage(r.usage, Array.isArray(r.data) ? r.data.length : 0);
                        if (!Array.isArray(r.data)) throw new Error('Phản hồi JSON không có mảng prompt.');
                        return r.data;
                    }, {
                        attempts: 3,
                        signal,
                        isAbort: (err) => isStopError(err) || signal.aborted,
                        onRetry: (attempt, error) => {
                            const em = error instanceof Error ? error.message : String(error);
                            logStatus(`⚠️ ${label} lỗi tạm lần ${attempt}: ${em}`, 'err');
                        },
                    });
                }, {
                    singleAttempts: 2,
                    isAbort: (err) => isStopError(err) || signal.aborted,
                    onSplit: (size, reason) => logStatus(`🧩 ${label}: tách đôi lô ${size} dòng vì ${splitReasonLabel(reason)}. ${reason}`, 'err'),
                    onKeep: (index, prompt) => {
                        const original = items[index];
                        const full = `${original.id}_${prompt}, ${styleSuffix}`;
                        setResults(prev => prev.map(row => row.id === original.id ? { ...row, prompt: full } : row));
                    },
                });
                prompts.forEach((prompt, index) => {
                    if (prompt) {
                        successCount++;
                        return;
                    }
                    const original = items[index];
                    const msg = errors[index] || 'không tạo được prompt khi thử lại';
                    const marker = formatPromptLineError(original.id, msg);
                    console.warn(`[Prompts ảnh] Dòng ${original.id} vẫn lỗi sau thử lại: ${msg}`);
                    promptLog(`[LỖI] dòng ${original.id}: ${msg.replace(/\s+/g, ' ').trim()}`, 'err');
                    setResults(prev => prev.map(row => row.id === original.id ? { ...row, prompt: marker } : row));
                });
            }

            const stillFailed = failedItems.length - successCount;
            logStatus(signal.aborted
                ? `⏹ Đã dừng thử lại — tạo bù được ${successCount} dòng.`
                : stillFailed > 0
                    ? `⚠️ Đã thử lại xong: tạo được ${successCount}, còn ${stillFailed} dòng chưa chạy được.`
                    : '✨ Đã thử lại hoàn tất!'
            );
        } catch (e) {
            if (isStopError(e) || signal.aborted) {
                logStatus('⏹ Đã dừng thử lại theo yêu cầu.', 'err');
            } else {
                const em = e instanceof Error ? e.message : 'Lỗi khi thử lại.';
                setError(em);
                logStatus(`❌ Lỗi khi thử lại: ${em}`, 'err');
            }
        } finally {
            promptAbortRef.current = null;
            setIsLoading(false);
            setTimeout(() => setStatus(''), 5000);
        }
    }, [results, styleSuffix, apiProvider, characters, edoChars, customInstructions, promptTextModel, addUsage, promptLog, logStatus]);

    const handleDownload = async () => {
        if (results.some(r => r.prompt)) {
            // Nút tải TAY cũng phải đính 2 sheet "Tạo hình" + "Nhân vật" y hệt
            // auto-export — trước đây thiếu, bấm tay là ghi đè mất sheet (lỗi 2026-08-12).
            const sheets = edoChars.length ? buildTaoHinhSheets(edoChars) : undefined;
            // Nếu chưa chọn folder, yêu cầu chọn trước
            if (!selectedFolder && typeof window !== 'undefined' && (window as any).electronAPI) {
                try {
                    const folderPath = await (window as any).electronAPI.selectFolder();
                    if (folderPath) {
                        setSelectedFolder(folderPath);
                        // Sau khi chọn folder, tiếp tục download
                        let fileName = 'generated_prompts.xlsx';
                        let inputFileName = '';
                        if (files.length > 0) {
                            const baseName = files[0].name.replace(/\.[^/.]+$/, "");
                            fileName = `${baseName}_prompts.xlsx`;
                            inputFileName = files[0].name;
                        }
                        await exportToExcel(results, fileName, folderPath, inputFileName, [],
                            sheets?.taoHinhRows, sheets?.nhanVatRows);
                    }
                } catch (error) {
                    const em = error instanceof Error ? error.message : String(error);
                    console.error('Error selecting folder:', error);
                    setError(`Lỗi khi xuất Excel: ${em}`);
                    promptLog(`❌ Lỗi khi xuất Excel: ${em}`, 'err');
                }
            } else {
                // Đã có folder hoặc không phải Electron → download bình thường
                try {
                    let fileName = 'generated_prompts.xlsx';
                    let inputFileName = '';
                    if (files.length > 0) {
                        const baseName = files[0].name.replace(/\.[^/.]+$/, "");
                        fileName = `${baseName}_prompts.xlsx`;
                        inputFileName = files[0].name;
                    }
                    await exportToExcel(results, fileName, selectedFolder, inputFileName, [],
                        sheets?.taoHinhRows, sheets?.nhanVatRows);
                } catch (error) {
                    const em = error instanceof Error ? error.message : String(error);
                    console.error(error);
                    setError(`Lỗi khi xuất Excel: ${em}`);
                    promptLog(`❌ Lỗi khi xuất Excel: ${em}`, 'err');
                }
            }
        } else {
            const line = 'Chưa có prompt nào được tạo để xuất.';
            setError(line);
            promptLog(`⚠️ ${line}`, 'err');
        }
    };

    useEffect(() => {
        batchLatestJobsRef.current = batchImageJobs;
    }, [batchImageJobs]);

    useEffect(() => {
        batchLatestRefsRef.current = batchReferenceImages;
    }, [batchReferenceImages]);

    const cloneImageJobs = (jobsToClone: ImageJob[]): ImageJob[] =>
        jobsToClone.map(job => ({ ...job }));

    const cloneReferences = (refsToClone: ReferenceImage[]): ReferenceImage[] =>
        refsToClone.map(ref => ({ ...ref }));

    const resetJobsForBatchRun = (jobsToReset: ImageJob[]): ImageJob[] =>
        jobsToReset.map(job => ({
            ...job,
            status: 'pending',
            imageUrl: undefined,
            error: undefined,
            referencedChars: undefined,
            modelUsed: undefined,
            videoStatus: undefined,
            videoUrl: undefined,
            videoError: undefined
        }));

    const sanitizeFolderName = (name: string): string =>
        name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();

    const handleSaveBatchProject = () => {
        const trimmedName = batchProjectName.trim();
        if (!trimmedName) {
            setBatchStatus('Vui lòng nhập tên dự án.');
            return;
        }

        if (batchImageJobs.length === 0) {
            setBatchStatus('Dự án phải có ít nhất 1 prompt ảnh.');
            return;
        }

        const projectId = `batch-project-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const projectToSave: BatchImageProject = {
            id: projectId,
            name: trimmedName,
            jobs: cloneImageJobs(batchImageJobs),
            references: cloneReferences(batchReferenceImages),
            characterJobs: cloneImageJobs(batchCharacterJobs),
            createdAt: Date.now()
        };

        setBatchProjects(prev => [...prev, projectToSave]);
        setBatchSelectedProjectId(null);
        setBatchStatus(`Đã thêm dự án mới "${trimmedName}" vào hàng chờ.`);
    };

    const handleUpdateBatchProject = () => {
        if (!batchSelectedProjectId) {
            setBatchStatus('Chưa nạp dự án nào để cập nhật. Hãy bấm "Nạp vào form".');
            return;
        }

        const trimmedName = batchProjectName.trim();
        if (!trimmedName) {
            setBatchStatus('Vui lòng nhập tên dự án.');
            return;
        }

        if (batchImageJobs.length === 0) {
            setBatchStatus('Dự án phải có ít nhất 1 prompt ảnh.');
            return;
        }

        setBatchProjects(prev =>
            prev.map(project =>
                project.id === batchSelectedProjectId
                    ? {
                        ...project,
                        name: trimmedName,
                        jobs: cloneImageJobs(batchImageJobs),
                        references: cloneReferences(batchReferenceImages),
                        characterJobs: cloneImageJobs(batchCharacterJobs)
                    }
                    : project
            )
        );
        setBatchStatus(`Đã cập nhật dự án "${trimmedName}".`);
    };

    const handleCreateNewBatchDraft = () => {
        setBatchSelectedProjectId(null);
        setBatchProjectName('');
        setBatchReferenceImages([]);
        setBatchImageJobs([]);
        setBatchCharacterJobs([]);
        setBatchStatus('Đang tạo dự án mới. Nhập tên + cấu hình rồi bấm "Lưu dự án mới".');
    };

    const handleLoadBatchProject = (project: BatchImageProject) => {
        setBatchSelectedProjectId(project.id);
        setBatchProjectName(project.name);
        setBatchReferenceImages(cloneReferences(project.references));
        setBatchImageJobs(cloneImageJobs(project.jobs));
        setBatchCharacterJobs(cloneImageJobs(project.characterJobs || []));
        setBatchStatus(`Đã nạp dự án "${project.name}".`);
    };

    const handleDeleteBatchProject = (projectId: string) => {
        setBatchProjects(prev => prev.filter(p => p.id !== projectId));
        if (batchSelectedProjectId === projectId) {
            setBatchSelectedProjectId(null);
        }
    };

    const runSingleBatchProject = async (project: BatchImageProject): Promise<void> => {
        const projectFolderName = sanitizeFolderName(project.name) || `project-${project.id}`;
        let projectOutputFolder = batchOutputFolder;

        if (batchOutputFolder && typeof window !== 'undefined' && (window as any).electronAPI) {
            try {
                const api = (window as any).electronAPI;
                const subFolder = await api.pathJoin(batchOutputFolder, projectFolderName);
                await api.mkdir(subFolder);
                projectOutputFolder = subFolder;
            } catch (e) {
                console.error('Không thể tạo thư mục dự án:', e);
            }
        }

        setBatchCurrentRunOutputFolder(projectOutputFolder || batchOutputFolder);
        setBatchRunningProjectId(project.id);
        setBatchProjectName(project.name);
        setBatchSelectedProjectId(project.id);
        setBatchReferenceImages(cloneReferences(project.references));
        setBatchCharacterJobs(cloneImageJobs(project.characterJobs || []));
        setBatchImageJobs(resetJobsForBatchRun(cloneImageJobs(project.jobs)));

        await new Promise<void>(resolve => setTimeout(resolve, 50));

        await new Promise<void>((resolve) => {
            batchRunResolverRef.current = () => resolve();
            setBatchRunRequestId(prev => prev + 1);
        });

        const finishedJobs = cloneImageJobs(batchLatestJobsRef.current);
        const finishedRefs = cloneReferences(batchLatestRefsRef.current);

        setBatchProjects(prev =>
            prev.map(p =>
                p.id === project.id
                    ? { ...p, jobs: finishedJobs, references: finishedRefs, lastRunAt: Date.now() }
                    : p
            )
        );
    };

    const handleRunAllBatchProjects = async () => {
        if (batchProjects.length === 0) {
            setBatchStatus('Chưa có dự án nào trong hàng chờ.');
            return;
        }

        setIsBatchRunning(true);
        setBatchStatus(`Bắt đầu chạy ${batchProjects.length} dự án...`);

        try {
            const queue = [...batchProjects];
            for (let i = 0; i < queue.length; i++) {
                const project = queue[i];
                setBatchStatus(`Đang chạy dự án ${i + 1}/${queue.length}: ${project.name}`);
                await runSingleBatchProject(project);
            }
            setBatchStatus('Đã chạy xong toàn bộ dự án trong hàng chờ.');
        } catch (e) {
            setBatchStatus(`Batch bị gián đoạn: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setBatchRunningProjectId(null);
            setBatchCurrentRunOutputFolder(null);
            setIsBatchRunning(false);
        }
    };

    // --- VEO3 PROMPT: phân tích nhân vật (cùng logic tab Tạo Prompts ảnh) ---
    const handleVeo3AnalyzeCharacters = useCallback(async () => {
        if (veo3RawSubtitles.length === 0) {
            setVeo3Error('Vui lòng tải lên nội dung kịch bản ở bước 3 trước.');
            return;
        }
        let activeApiKey = openaiApiKey;
        if (apiProvider === 'gemini') {
            if (useGoogleSheet && apiKeyManager) {
                const key = apiKeyManager.getRandomKey();
                if (!key) {
                    setVeo3Error('Không còn API key nào hoạt động. Vui lòng kiểm tra Google Sheet.');
                    return;
                }
                activeApiKey = key;
            } else {
                const keys = getGeminiKeys();
                if (keys.length === 0) {
                    setVeo3Error('Vui lòng nhập ít nhất 1 API Key cho Gemini trong phần Cấu hình.');
                    return;
                }
                activeApiKey = keys[Math.floor(Math.random() * keys.length)];
            }
        } else if (!activeApiKey) {
            setVeo3Error('Vui lòng nhập API Key cho OpenAI trong phần Cấu hình.');
            return;
        }
        setVeo3IsLoading(true);
        setVeo3Error(null);
        setVeo3Status('🤖 Đang đọc kịch bản để phân tích nhân vật...');
        try {
            const fullText = veo3RawSubtitles.map(r => r.text).join('\n');
            const response = await analyzeCharacters(fullText, apiProvider, activeApiKey);
            addVeo3Usage(response.usage, 0);
            setVeo3Characters(response.data);
            setVeo3Status(`✅ Đã tìm thấy ${response.data.length} nhân vật.`);
        } catch (e) {
            console.warn('Veo3 analysis failed:', e);
            setVeo3Error(`Lỗi phân tích: ${e instanceof Error ? e.message : 'Không xác định'}`);
        } finally {
            setVeo3IsLoading(false);
            setTimeout(() => {
                setVeo3Status(prev => (prev.includes('✅') ? '' : prev));
            }, 3000);
        }
    }, [veo3RawSubtitles, apiProvider, openaiApiKey, getGeminiKeys]);

    const handleVeo3TransferCharacters = useCallback(() => {
        if (veo3Characters.length === 0) return;
        const CHARACTER_STYLE_PREFIX =
            'Edo-period animated style, bold black outlines, both front view, looking at viewer, 2/3 body shot, hands at sides, white background, masterpiece, best quality, high resolution.';
        const charJobs: ImageJob[] = veo3Characters.map((char, index) => ({
            id: `char-gen-veo3-${Date.now()}-${index}`,
            prompt: `${CHARACTER_STYLE_PREFIX} ${char.description}`,
            status: 'pending',
            isCharacterGen: true,
            characterName: char.name,
            aspectRatio: '9:16'
        }));
        setCharacterJobs(prev => [...prev, ...charJobs]);
        setActiveTab('image');
        setVeo3Status(`🚀 Đã thêm ${charJobs.length} nhân vật vào Bảng tạo hình.`);
        setTimeout(() => setVeo3Status(''), 3000);
    }, [veo3Characters]);

    const handleVeo3Generate = useCallback(async () => {
        if (veo3RawSubtitles.length === 0) {
            setVeo3Error('Chưa có SRT. Vui lòng tải file .srt.');
            return;
        }
        if (apiProvider === 'gemini') {
            if (useGoogleSheet && apiKeyManager) {
                const key = apiKeyManager.getNextKey();
                if (!key) {
                    setVeo3Error('Không còn API key nào hoạt động. Vui lòng kiểm tra Google Sheet hoặc đợi keys được load.');
                    return;
                }
            } else {
                const geminiKeys = getGeminiKeys();
                if (geminiKeys.length === 0) {
                    setVeo3Error('Đang tải API keys từ Google Sheet... Vui lòng đợi hoặc kiểm tra kết nối.');
                    return;
                }
            }
        }
        // Vertex-only: no OpenAI
        setVeo3IsLoading(true);
        setVeo3Error(null);

        let activeCharacters = [...veo3Characters];
        if (activeCharacters.length === 0) {
            setVeo3Status('🤖 Đang đọc kịch bản để phân tích nhân vật...');
            try {
                const fullText = veo3RawSubtitles.map(r => r.text).join('\n');
                let analysisKey: string;
                if (apiProvider === 'gemini') {
                    if (useGoogleSheet && apiKeyManager) {
                        const key = apiKeyManager.getRandomKey();
                        if (!key) throw new Error('Không còn API key nào hoạt động');
                        analysisKey = key;
                    } else {
                        const geminiKeys = getGeminiKeys();
                        if (geminiKeys.length === 0) throw new Error('Không có API keys');
                        analysisKey = geminiKeys[Math.floor(Math.random() * geminiKeys.length)];
                    }
                } else {
                    analysisKey = openaiApiKey;
                }
                const response = await analyzeCharacters(fullText, apiProvider, analysisKey);
                if (useGoogleSheet && apiKeyManager && apiProvider === 'gemini') {
                    apiKeyManager.markKeySuccess(analysisKey);
                }
                addVeo3Usage(response.usage, 0);
                setVeo3Characters(response.data);
                activeCharacters = response.data;
                setVeo3Status(`✅ Đã tìm thấy ${response.data.length} nhân vật.`);
            } catch (e) {
                console.warn('Veo3 character analysis failed:', e);
                setVeo3Status('⚠️ Không tìm thấy nhân vật, tiếp tục tạo prompt thường...');
            }
        }
        setVeo3Status('🎬 AI đang đọc SRT và tạo prompts Veo (số clip & thời lượng do AI quyết định)...');
        try {
            // Vertex-only: no API key checks needed
            const fallbackKey = '';

            const onPromptRetry: OnRetryCallback = ({ waitSeconds }) => {
                setVeo3Status(`⚠️ Lỗi gọi API. Thử lại sau ${waitSeconds}s...`);
            };

            const response = await withRetry(
                async () => {
                    let key: string;
                    if (apiProvider === 'gemini') {
                        if (useGoogleSheet && apiKeyManager) {
                            const next = apiKeyManager.getNextKey();
                            if (!next) throw new Error('No active API keys');
                            key = next;
                        } else {
                            key = fallbackKey;
                        }
                    } else {
                        key = openaiApiKey;
                    }
                    try {
                        const result = await generateVeo3PromptsFromSrt(
                            veo3RawSubtitles,
                            apiProvider,
                            activeCharacters,
                            key,
                            veo3CustomInstructions
                        );
                        if (useGoogleSheet && apiKeyManager) apiKeyManager.markKeySuccess(key);
                        return result;
                    } catch (error) {
                        if (useGoogleSheet && apiKeyManager && apiProvider === 'gemini') {
                            const err = error instanceof Error ? error : new Error(String(error));
                            apiKeyManager.markKeyFailed(key, err);
                        // Vertex-only: no Google Sheet error logging
                        }
                        throw error;
                    }
                },
                3,
                onPromptRetry
            );

            const clips = response.data;
            addVeo3Usage(response.usage, clips.length);

            const nextResults: PromptResult[] = clips.map((clip, i) => ({
                id: i + 1,
                timeRange: clip.timeRange,
                subtitle: '',
                prompt: `${i + 1}_${clip.prompt}, ${veo3StyleSuffix}`
            }));
            setVeo3Results(nextResults);

            let fileName = 'generated_veo3_prompts.xlsx';
            let inputFileName = '';
            if (veo3PromptFiles.length > 0) {
                const baseName = veo3PromptFiles[0].name.replace(/\.[^/.]+$/, '');
                fileName = `${baseName}_veo3_prompts.xlsx`;
                inputFileName = veo3PromptFiles[0].name;
            }
            const rows = clips.map((clip, i) => ({
                stt: i + 1,
                time: clip.timeRange,
                prompt: `${i + 1}_${clip.prompt}, ${veo3StyleSuffix}`
            }));
            await exportVeo3PromptsToExcel(rows, fileName, selectedFolder, inputFileName);

            if (currentUser && userTokenUsed > 0) {
                try {
                    await updateUserToken(currentUser, userTokenUsed);
                } catch (error) {
                    console.error('❌ Error syncing token:', error);
                }
            }
            setVeo3Status('✨ Hoàn tất!');
        } catch (e) {
            console.error(e);
            setVeo3Error(`Quá trình thất bại: ${e instanceof Error ? e.message : 'Lỗi không xác định'}`);
        } finally {
            setVeo3IsLoading(false);
            setTimeout(() => setVeo3Status(''), 5000);
        }
    }, [
        veo3RawSubtitles,
        veo3StyleSuffix,
        apiProvider,
        openaiApiKey,
        getGeminiKeys,
        veo3Characters,
        veo3CustomInstructions,
        currentUser,
        userTokenUsed,
        veo3PromptFiles,
        selectedFolder
    ]);

    const handleVeo3Retry = useCallback(async () => {
        const failedItems = veo3Results.filter(r => !r.prompt || r.prompt.trim() === '');
        if (failedItems.length === 0) return;
        // Vertex-only: just regenerate from SRT
        setVeo3Status('⏳ Đang đợi 5s rồi tạo lại từ SRT...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        await handleVeo3Generate();
    }, [veo3Results, handleVeo3Generate]);

    const handleVeo3Download = async () => {
        if (!veo3Results.some(r => r.prompt)) {
            setVeo3Error('Chưa có prompt nào được tạo để xuất.');
            return;
        }
        const rows = veo3Results
            .filter(r => r.prompt && r.prompt.trim() !== '')
            .map(r => ({
                stt: r.id,
                time: r.timeRange || '',
                prompt: r.prompt
            }));
        let fileName = 'generated_veo3_prompts.xlsx';
        let inputFileName = '';
        if (veo3PromptFiles.length > 0) {
            const baseName = veo3PromptFiles[0].name.replace(/\.[^/.]+$/, '');
            fileName = `${baseName}_veo3_prompts.xlsx`;
            inputFileName = veo3PromptFiles[0].name;
        }
        if (!selectedFolder && typeof window !== 'undefined' && (window as any).electronAPI) {
            try {
                const folderPath = await (window as any).electronAPI.selectFolder();
                if (folderPath) {
                    setSelectedFolder(folderPath);
                    await exportVeo3PromptsToExcel(rows, fileName, folderPath, inputFileName);
                }
            } catch (error) {
                console.error('Error selecting folder:', error);
                setVeo3Error('Lỗi khi chọn thư mục. Vui lòng thử lại.');
            }
        } else {
            await exportVeo3PromptsToExcel(rows, fileName, selectedFolder, inputFileName);
        }
    };

    const handleTransferVeo3PromptsToVeoVideo = () => {
        const generatedItems = veo3Results.filter(r => r.prompt && r.prompt.trim() !== '');
        if (generatedItems.length === 0) {
            setVeo3Error('Chưa có prompt nào được tạo để chuyển.');
            return;
        }
        setVeoPrefillForVeoQueue(generatedItems.map(r => r.prompt!));
        setActiveTab('veo3');
        setVeo3Status(`🚀 Đã chuyển ${generatedItems.length} prompt sang tab Tạo Veo3!`);
        setTimeout(() => setVeo3Status(''), 3000);
    };
    
    const failedCount = results.filter(r => !isUsableImagePrompt(r.prompt)).length;
    const hasPrompts = results.some(r => isUsableImagePrompt(r.prompt));
    const prompt2FailedCount = prompt2Results.filter(r => !r.prompt || r.prompt.trim() === '').length;
    const prompt2HasPrompts = prompt2Results.some(r => r.prompt && r.prompt.trim() !== '');
    const veo3FailedCount = veo3Results.filter(r => !r.prompt || r.prompt.trim() === '').length;
    const veo3HasPrompts = veo3Results.some(r => r.prompt && r.prompt.trim() !== '');

    // Check if user is logged in
    if (!isLoggedIn) {
        return <LoginScreen onLogin={handleLogin} />;
    }

    return (
        <div className="min-h-screen bg-gray-900 text-gray-200 p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto">
                <header className="flex flex-col md:flex-row justify-between items-center mb-6 border-b border-gray-800 pb-6">
                    <div className="flex items-center space-x-3">
                         <div className="bg-gradient-to-r from-blue-600 to-purple-600 w-12 h-12 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
                             <i className="fa-solid fa-wand-magic-sparkles text-white text-2xl"></i>
                         </div>
                        <div>
                             <div className="flex items-center gap-3">
                                <h1 className="text-2xl font-bold text-white tracking-tight">
                                    FLOW CONTENT
                                </h1>
                                <span className="rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-200">
                                    v{APP_VERSION}
                                </span>
                            </div>
                            <p className="text-yellow-500 text-xs uppercase tracking-wider font-semibold">TIỀN VÀO NHƯ NƯỚC SÔNG ĐÀ</p>
                        </div>
                    </div>
                    
                    {/* User info & Token display */}
                    <div className="mt-4 md:mt-0 flex items-center space-x-4">
                        <div className="bg-gray-800 rounded-lg px-4 py-2 border border-gray-700">
                            <div className="flex items-center space-x-2 text-sm">
                                <i className="fa-solid fa-user text-blue-200"></i>
                                <span className="text-gray-300">{currentUser}</span>
                                <span className="text-xs text-green-400 ml-2">∞ Unlimited</span>
                            </div>
                            <div className="flex items-center space-x-2 text-xs mt-1">
                                <i className="fa-solid fa-chart-line text-blue-400"></i>
                                <span className="text-blue-400 font-bold">{userTokenUsed.toLocaleString()}</span>
                                <span className="text-green-500"> $ đã kiếm được</span>
                            </div>
                        </div>
                        
                        <UpdateButton />

                        <button
                            onClick={() => setShowEndpointSettings(true)}
                            className="bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 px-3 py-2 rounded-lg border border-blue-600/50 transition-all text-sm"
                            title="Cài đặt cổng Gemini"
                        >
                            <i className="fa-solid fa-gear"></i>
                        </button>

                        <button
                            onClick={handleLogout}
                            className="bg-red-600/20 hover:bg-red-600/30 text-red-400 px-3 py-2 rounded-lg border border-red-600/50 transition-all text-sm"
                            title="Đăng xuất"
                        >
                            <i className="fa-solid fa-right-from-bracket"></i>
                        </button>
                    </div>
                    
                </header>

                {/* ── ĐIỀU HƯỚNG 2 CẤP: nhóm tab tổng → tab con ─────────────────────── */}
                {(() => {
                    const activeGroup = TAB_GROUPS.find(g => g.tabs.some(t => t.id === activeTab)) || TAB_GROUPS[0];
                    return (
                        <div className="mb-6 space-y-2">
                            {/* Cấp 1 — nhóm */}
                            <div className="flex bg-gray-800 rounded-lg p-1 gap-1 w-full overflow-x-auto">
                                {TAB_GROUPS.map(g => (
                                    <button
                                        key={g.id}
                                        onClick={() => setActiveTab(g.tabs[0].id)}
                                        className={`px-5 py-2.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap ${activeGroup.id === g.id ? `${g.color} text-white shadow` : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}
                                    >
                                        <i className={`fa-solid ${g.icon} mr-2`}></i>{g.label}
                                    </button>
                                ))}
                            </div>
                            {/* Cấp 2 — tab con (chỉ hiện khi nhóm có nhiều hơn 1 tab) */}
                            {activeGroup.tabs.length > 1 && (
                                <div className="flex gap-1 px-1 overflow-x-auto">
                                    {activeGroup.tabs.map(t => (
                                        <button
                                            key={t.id}
                                            onClick={() => setActiveTab(t.id)}
                                            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap border ${activeTab === t.id ? 'bg-gray-700 text-white border-gray-500' : 'bg-gray-900/60 text-gray-400 border-gray-800 hover:text-white hover:border-gray-600'}`}
                                        >
                                            <i className={`fa-solid ${t.icon} mr-1.5`}></i>{t.label}
                                            {t.hint && <span className="ml-1.5 text-gray-500">· {t.hint}</span>}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* PROMPT GENERATOR VIEW (ALWAYS RENDERED, HIDDEN VIA CSS) */}
                <div className={activeTab === 'prompt' ? 'block animate-fade-in' : 'hidden'}>
                    <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-1 flex flex-col space-y-6">
                            <div className="bg-gray-800 p-5 rounded-xl shadow-lg border border-gray-700">
                                <SettingsPanel
                                    styleSuffix={styleSuffix}
                                    setStyleSuffix={setStyleSuffix}
                                    customInstructions={customInstructions}
                                    setCustomInstructions={setCustomInstructions}
                                    useAutoSplit={useAutoSplit}
                                    setUseAutoSplit={setUseAutoSplit}
                                    useAiSceneGrouping={useAiSceneGrouping}
                                    setUseAiSceneGrouping={setUseAiSceneGrouping}
                                    modelOptions={PROMPT_TEXT_MODEL_OPTIONS}
                                    selectedModel={promptTextModel}
                                    onSelectedModelChange={(value) => setPromptTextModel(value as PromptTextModelId)}

                                />

                                {/* Hậu tố style TẠO HÌNH — nối vào prompt vẽ ảnh nhân vật (sheet Tạo hình), giống tab Veo3 */}
                                <div className="mt-4 pt-4 border-t border-gray-700">
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-xs text-gray-400">
                                            <i className="fa-solid fa-user-astronaut mr-1 text-blue-300"></i>
                                            Hậu tố style TẠO HÌNH nhân vật
                                        </label>
                                        <button onClick={() => setImageCharStyle(EDO_CHAR_STYLE)}
                                            className="text-[11px] text-blue-300 hover:text-blue-200">↺ Mặc định</button>
                                    </div>
                                    <p className="text-[10px] text-gray-500 mb-1 leading-snug">
                                        Chỉ nối vào prompt vẽ ảnh nhân vật theo giai đoạn @ (sheet "Tạo hình" trong Excel),
                                        không dính tới style prompt ảnh từng dòng ở trên.
                                    </p>
                                    <textarea
                                        value={imageCharStyle} onChange={e => setImageCharStyle(e.target.value)} rows={4}
                                        className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 resize-y"
                                    />
                                </div>
                            </div>

                            <div className="bg-gray-800 p-5 rounded-xl shadow-lg border border-gray-700">
                                <CharacterManager 
                                    characters={characters} 
                                    setCharacters={setCharacters} 
                                    onAnalyze={handleAnalyzeCharacters}
                                    onTransferCharacters={handleTransferCharacters}
                                    isLoading={isLoading}
                                    hasContent={rawSubtitles.length > 0}
                                />
                            </div>

                            <div className="bg-gray-800 p-5 rounded-xl shadow-lg border border-gray-700">
                                <FileUpload 
                                    files={files} 
                                    setFiles={setFiles}
                                    selectedFolder={selectedFolder}
                                    onFolderSelect={setSelectedFolder}
                                />
                                
                                <div className="mt-6 border-t border-gray-700 pt-6">
                                    <ActionButtons
                                        onGenerate={handleGenerate}
                                        onRetry={handleRetry}
                                        onDownload={handleDownload}
                                        onStop={handleStopGenerate}
                                        onClearOld={handleClearOldScript}
                                        isLoading={isLoading}
                                        filesExist={files.length > 0}
                                        resultsExist={results.some(r => r.prompt !== '')}
                                        hasPrompts={hasPrompts}
                                        failedCount={(hasRunPrompts || hasPrompts) ? failedCount : 0}
                                        status={status}
                                        apiProvider={apiProvider}
                                        openaiApiKey={openaiApiKey}
                                    />
                                    <StatusBar error={error} usage={tokenUsage} />
                                </div>
                            </div>
                        </div>

                        <div className="lg:col-span-2 flex flex-col gap-4">
                            <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 h-[calc(100vh-12rem)] min-h-[60vh]">
                                <ResultsTable results={results} isLoading={isLoading} />
                            </div>
                            <div className="shrink-0 h-72 rounded-lg border border-slate-800 bg-slate-950/90 flex flex-col overflow-hidden">
                                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/60 shrink-0">
                                    <span className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
                                        <i className="fa-solid fa-terminal mr-1.5 text-emerald-400"></i>
                                        Nhật ký trực tiếp
                                        <span className="ml-2 text-slate-400 normal-case font-normal">({promptLogs.length})</span>
                                    </span>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => navigator.clipboard?.writeText(promptLogs.map(l => `${l.t} ${l.msg}`).join('\n'))}
                                            disabled={!promptLogs.length}
                                            title="Copy toàn bộ nhật ký"
                                            className="text-xs text-slate-300 hover:text-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            <i className="fa-solid fa-copy mr-1"></i>Copy
                                        </button>
                                        <button
                                            onClick={() => setPromptLogs([])}
                                            disabled={!promptLogs.length}
                                            title="Xóa nhật ký"
                                            className="text-xs text-slate-300 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            <i className="fa-solid fa-trash-can mr-1"></i>Xóa
                                        </button>
                                    </div>
                                </div>
                                <div ref={promptLogBoxRef} className="flex-1 overflow-y-auto px-4 py-2.5 font-mono text-sm leading-relaxed select-text">
                                    {promptLogs.length === 0 ? (
                                        <p className="text-slate-300">Nạp file rồi bấm Tạo Prompts. Lỗi giữ ở đây để copy.</p>
                                    ) : promptLogs.map((l, i) => (
                                        <div key={i} className={`flex gap-2 break-words ${l.kind === 'err' ? 'text-red-400 font-semibold' : l.kind === 'ok' ? 'text-emerald-400' : 'text-slate-100'}`}>
                                            <span className="text-slate-400 shrink-0">{l.t}</span>
                                            <i className={`fa-solid ${l.kind === 'err' ? 'fa-circle-xmark' : l.kind === 'ok' ? 'fa-circle-check' : 'fa-circle-info'} shrink-0 mt-1`}></i>
                                            <span className="whitespace-pre-wrap">{l.msg}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </main>
                </div>

                <div className={activeTab === 'isekai-prompt' ? 'block animate-fade-in' : 'hidden'}>
                    <IsekaiPromptPanel
                        onUsage={addIsekaiPromptCount}
                        onTransferCharacterJobs={handleIsekaiTransferCharacterJobs}
                    />
                </div>

                {/* PROMPT GENERATOR 2 VIEW */}
                <div className={activeTab === 'prompt2' ? 'block animate-fade-in' : 'hidden'}>
                    <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-1 flex flex-col space-y-6">
                            <div className="bg-gray-800 p-5 rounded-xl shadow-lg border border-gray-700">
                                <div className="mb-4 rounded-lg border border-cyan-700/60 bg-cyan-950/30 p-4">
                                    <h2 className="text-lg font-semibold text-cyan-300">Tạo Prompts 2</h2>
                                    <p className="mt-1 text-sm text-gray-300">
                                        Không phân tích nhân vật. Tab này tạo prompt độc lập cho History, vũ trụ, tôn giáo, thần thoại, kiến trúc, địa danh và các cảnh không cần nhân vật xuyên suốt.
                                    </p>
                                </div>
                                <SettingsPanel
                                    styleSuffix={prompt2StyleSuffix}
                                    setStyleSuffix={setPrompt2StyleSuffix}
                                    customInstructions={prompt2CustomInstructions}
                                    setCustomInstructions={setPrompt2CustomInstructions}
                                    useAutoSplit={prompt2UseAutoSplit}
                                    setUseAutoSplit={setPrompt2UseAutoSplit}
                                    useAiSceneGrouping={prompt2UseAiSceneGrouping}
                                    setUseAiSceneGrouping={setPrompt2UseAiSceneGrouping}
                                    idPrefix="prompt2-"
                                />
                            </div>

                            <div className="bg-gray-800 p-5 rounded-xl shadow-lg border border-gray-700">
                                <FileUpload
                                    files={prompt2Files}
                                    setFiles={setPrompt2Files}
                                    selectedFolder={prompt2SelectedFolder}
                                    onFolderSelect={setPrompt2SelectedFolder}
                                />

                                <div className="mt-6 border-t border-gray-700 pt-6">
                                    <ActionButtons
                                        onGenerate={handlePrompt2Generate}
                                        onRetry={handlePrompt2Retry}
                                        onDownload={handlePrompt2Download}
                                        onTransfer={handlePrompt2TransferToImageGen}
                                        onStop={handleStopPrompt2}
                                        isLoading={prompt2IsLoading}
                                        filesExist={prompt2Files.length > 0}
                                        resultsExist={prompt2Results.some(r => r.prompt !== '')}
                                        hasPrompts={prompt2HasPrompts}
                                        failedCount={(prompt2HasRun || prompt2HasPrompts) ? prompt2FailedCount : 0}
                                        status={prompt2Status}
                                        apiProvider={apiProvider}
                                        openaiApiKey={openaiApiKey}
                                    />
                                    <StatusBar error={prompt2Error} usage={prompt2TokenUsage} />
                                </div>
                            </div>
                        </div>

                        <div className="lg:col-span-2 bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 h-[calc(100vh-12rem)] min-h-[500px]">
                            <ResultsTable results={prompt2Results} isLoading={prompt2IsLoading} />
                        </div>
                    </main>
                </div>

                {/* HOOK VIDEO GENERATOR VIEW */}
                <div className={activeTab === 'veo3' ? 'block animate-fade-in' : 'hidden'}>
                    <main>
                        <Veo3Panel
                            isLoadingKeys={isLoadingSheet}
                            outputFolder={selectedFolder}
                            onOutputFolderSelect={setSelectedFolder}
                            prefilledPrompts={veoPrefillForVeoQueue}
                            onPrefilledPromptsConsumed={() => setVeoPrefillForVeoQueue(null)}
                        />
                    </main>
                </div>

                {/* IMAGE GENERATOR VIEW */}
                <div className={activeTab === 'image' ? 'block animate-fade-in' : 'hidden'}>
                    {IMAGE_TAB_LOCKED ? (
                    <main className="min-h-[500px] flex items-center justify-center">
                        <div className="w-full max-w-xl rounded-xl border border-purple-700/60 bg-gray-800 p-8 text-center shadow-lg">
                            <i className="fa-solid fa-screwdriver-wrench text-4xl text-purple-300 mb-4"></i>
                            <h2 className="text-3xl font-bold text-white tracking-wide">ĐANG PHÁT TRIỂN</h2>
                            <p className="mt-3 text-sm text-gray-400">
                                Tab Tạo Ảnh AI đang được khóa tạm thời. Dữ liệu prompt đã chuyển sang hàng chờ vẫn được giữ để mở lại sau.
                            </p>
                        </div>
                    </main>
                    ) : (
                    <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-1 flex flex-col space-y-6">
                            {/* Updated ReferenceManager with jobs prop */}
                            <ReferenceManager 
                                references={referenceImages} 
                                setReferences={setReferenceImages} 
                                jobs={imageJobs}
                            />
                            
                            <CharacterGenPanel 
                                jobs={characterJobs} 
                                setJobs={setCharacterJobs}
                                geminiApiKey={useGoogleSheet && apiKeyManager ? apiKeyManager.getAllActiveKeys().join('\n') : geminiApiKey}
                                setReferences={setReferenceImages}
                            />
                        </div>

                        <div className="lg:col-span-2">
                             <ImageGenPanel 
                                referenceImages={referenceImages} 
                                jobs={imageJobs} 
                                setJobs={setImageJobs}
                                setReferences={setReferenceImages}
                                outputFolder={selectedFolder}
                                onOutputFolderSelect={setSelectedFolder}
                                onImageGenerated={(count: number) => {
                                    // 1 image = 1 token (accumulate, update tức thì)
                                    const tokensUsed = count;
                                    setSessionTokenUsed(prev => prev + tokensUsed);
                                    setUserTokenUsed(prev => {
                                        const newTotal = prev + tokensUsed;
            // Lưu ngay vào localStorage (tức thì)
                                        localStorage.setItem('userTokenUsed', newTotal.toString());
                                        if (currentUser) {
                                            localStorage.setItem(`${currentUser}_tokenUsed`, newTotal.toString());
                                        }
                                        return newTotal;
                                    });
                                }}
                             />
                        </div>
                    </main>
                    )}
                </div>

                {/* BATCH IMAGE GENERATOR VIEW */}
                <div className={activeTab === 'batch-image' ? 'block animate-fade-in space-y-4' : 'hidden'}>
                    <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
                            <input
                                type="text"
                                value={batchProjectName}
                                onChange={(e) => setBatchProjectName(e.target.value)}
                                placeholder="Tên dự án hàng loạt"
                                className="lg:col-span-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white"
                            />
                            <button
                                onClick={handleSaveBatchProject}
                                disabled={isBatchRunning}
                                className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 text-white px-4 py-2 rounded font-semibold"
                            >
                                <i className="fa-solid fa-floppy-disk mr-2"></i>Lưu dự án mới
                            </button>
                            <button
                                onClick={handleUpdateBatchProject}
                                disabled={isBatchRunning || !batchSelectedProjectId}
                                className="bg-amber-600 hover:bg-amber-700 disabled:bg-gray-600 text-white px-4 py-2 rounded font-semibold"
                                title="Chỉ dùng khi bạn đã bấm Nạp vào form một dự án"
                            >
                                <i className="fa-solid fa-pen-to-square mr-2"></i>Cập nhật dự án đang nạp
                            </button>
                            <button
                                onClick={handleCreateNewBatchDraft}
                                disabled={isBatchRunning}
                                className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 text-white px-4 py-2 rounded font-semibold"
                            >
                                <i className="fa-solid fa-plus mr-2"></i>Tạo dự án mới
                            </button>
                            <button
                                onClick={handleRunAllBatchProjects}
                                disabled={isBatchRunning || batchProjects.length === 0}
                                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white px-4 py-2 rounded font-semibold lg:col-span-4"
                            >
                                <i className="fa-solid fa-play mr-2"></i>Chạy toàn bộ hàng chờ
                            </button>
                        </div>
                        {batchStatus && <p className="text-sm text-emerald-300 mt-3">{batchStatus}</p>}
                    </div>

                    <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 max-h-48 overflow-y-auto">
                        <h3 className="font-semibold text-gray-200 mb-2">Hàng chờ dự án ({batchProjects.length})</h3>
                        {batchProjects.length === 0 ? (
                            <p className="text-sm text-gray-500">Chưa có dự án nào. Cấu hình prompts + tham chiếu rồi bấm "Lưu dự án mới".</p>
                        ) : (
                            <div className="space-y-2">
                                {batchProjects.map((project, idx) => (
                                    <div key={project.id} className="flex items-center justify-between bg-gray-900/60 border border-gray-700 rounded px-3 py-2">
                                        <div className="text-sm">
                                            <span className="text-gray-300 mr-2">{idx + 1}.</span>
                                            <span className="text-white font-medium">{project.name}</span>
                                            <span className="text-gray-400 ml-2">({project.jobs.length} prompts, {project.references.length} refs)</span>
                                            {batchRunningProjectId === project.id && (
                                                <span className="ml-2 text-xs text-blue-300"><i className="fa-solid fa-spinner fa-spin mr-1"></i>Đang chạy</span>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleLoadBatchProject(project)}
                                                disabled={isBatchRunning}
                                                className="text-xs px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 text-white"
                                                title="Nạp cấu hình dự án này vào form bên dưới để xem/chỉnh sửa/chạy thủ công"
                                            >
                                                Nạp vào form
                                            </button>
                                            <button
                                                onClick={() => handleDeleteBatchProject(project.id)}
                                                disabled={isBatchRunning}
                                                className="text-xs px-3 py-1 rounded bg-red-800 hover:bg-red-700 disabled:bg-gray-600 text-white"
                                            >
                                                Xóa
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-1 flex flex-col space-y-6">
                            <ReferenceManager
                                references={batchReferenceImages}
                                setReferences={setBatchReferenceImages}
                                jobs={batchImageJobs}
                            />

                            <CharacterGenPanel
                                jobs={batchCharacterJobs}
                                setJobs={setBatchCharacterJobs}
                                geminiApiKey={useGoogleSheet && apiKeyManager ? apiKeyManager.getAllActiveKeys().join('\n') : geminiApiKey}
                                setReferences={setBatchReferenceImages}
                            />
                        </div>

                        <div className="lg:col-span-2">
                            <ImageGenPanel
                                referenceImages={batchReferenceImages}
                                jobs={batchImageJobs}
                                setJobs={setBatchImageJobs}
                                setReferences={setBatchReferenceImages}
                                outputFolder={batchCurrentRunOutputFolder || batchOutputFolder || selectedFolder}
                                onOutputFolderSelect={(folderPath) => {
                                    setBatchOutputFolder(folderPath);
                                    setBatchCurrentRunOutputFolder(null);
                                    setSelectedFolder(folderPath);
                                }}
                                runRequestId={batchRunRequestId}
                                skipReferenceWarning={isBatchRunning}
                                onRunComplete={(summary) => {
                                    if (batchRunResolverRef.current) {
                                        batchRunResolverRef.current(summary);
                                        batchRunResolverRef.current = null;
                                    }
                                }}
                                onImageGenerated={(count: number) => {
                                    const tokensUsed = count;
                                    setSessionTokenUsed(prev => prev + tokensUsed);
                                    setUserTokenUsed(prev => {
                                        const newTotal = prev + tokensUsed;
                                        localStorage.setItem('userTokenUsed', newTotal.toString());
                                        if (currentUser) {
                                            localStorage.setItem(`${currentUser}_tokenUsed`, newTotal.toString());
                                        }
                                        return newTotal;
                                    });
                                }}
                            />
                        </div>
                    </main>
                </div>

                {/* LOCALIZATION VIEW */}
                <div className={activeTab === 'localization' ? 'block animate-fade-in' : 'hidden'} style={{ height: 'calc(100vh - 10rem)' }}>
                    <ScriptWorkspace mode="localization" />
                </div>

                {/* REVERSE THINKING VIEW */}
                <div className={activeTab === 'reverse-thinking' ? 'block animate-fade-in' : 'hidden'} style={{ height: 'calc(100vh - 10rem)' }}>
                    <ScriptWorkspace mode="reverse_thinking" />
                </div>

                {/* FRESH REWRITE VIEW — Viết Lại: cùng ngôn ngữ, hay hơn, giữ độ dài, đổi 100% tên nhân vật */}
                <div className={activeTab === 'fresh-rewrite' ? 'block animate-fade-in' : 'hidden'} style={{ height: 'calc(100vh - 10rem)' }}>
                    <ScriptWorkspace mode="fresh_rewrite" />
                </div>

                {/* MANHWA REWRITE — giữ tên + thuật ngữ, giọng recap, POV theo bản gốc */}
                <div className={activeTab === 'manhwa' ? 'block animate-fade-in' : 'hidden'} style={{ height: 'calc(100vh - 10rem)' }}>
                    <ScriptWorkspace mode="manhwa_rewrite" />
                </div>

                {/* VEO3 PROMPTS VIEW — mỗi dòng SRT → prompt video khóa timeline, dài thì chia đều */}
                <div className={activeTab === 'veo3-prompts' ? 'block animate-fade-in' : 'hidden'}>
                    <Veo3PromptsPanel />
                </div>

                {/* UKIYO-E EDO VIEW — SRT truyện cổ Nhật → prompt Veo3 tranh khắc gỗ, khóa nhân vật bằng mô tả */}
                <div className={activeTab === 'ukiyoe' ? 'block animate-fade-in' : 'hidden'}>
                    <UkiyoePanel />
                </div>

                {/* JOSEON VIEW — SRT truyện dân gian Hàn (야담) → prompt Veo3 hoạt hình 2D manhwa */}
                <div className={activeTab === 'joseon' ? 'block animate-fade-in' : 'hidden'}>
                    <JoseonPanel />
                </div>

                {/* EDO @ VIEW — bản Edo Nhật của tab 3: đồng bộ @ + tạo hình, xuất cùng định dạng */}
                <div className={activeTab === 'edo-at' ? 'block animate-fade-in' : 'hidden'}>
                    <EdoPanel />
                </div>

                {/* PHIM TỔNG TÀI VIEW — kho blueprint + máy xào + máy ra master prompts Veo3 (@Tên) */}
                <div className={activeTab === 'tong-tai' ? 'block animate-fade-in' : 'hidden'}>
                    <TongTaiPanel />
                </div>

                {/* TTS GEMINI VIEW — cxl-services + NextCaptcha + proxy xoay (Home/Top), WAV */}
                <div className={activeTab === 'tts-gemini' ? 'block animate-fade-in' : 'hidden'}>
                    <TTSGeminiPanel />
                </div>

                {/* CAMP CONTENT VIEW — pipeline mỗi video: tải sub -> viết lại -> review -> TTS -> prompts */}
                <div className={activeTab === 'camp-content' ? 'block animate-fade-in' : 'hidden'}>
                    <CampContentPanel />
                </div>

            </div>

            <EndpointSettingsModal
                isOpen={showEndpointSettings}
                onClose={() => setShowEndpointSettings(false)}
            />
        </div>
    );
};

export default App;
