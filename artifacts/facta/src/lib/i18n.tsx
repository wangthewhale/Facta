import React, { createContext, useContext, useState, useEffect } from 'react';

type Lang = 'zh' | 'en';

const translations = {
  zh: {
    app_name: 'FACTA',
    tagline_en: 'Every choice deserves evidence.',
    tagline_zh: '每個選擇，都值得有證據。',
    trust_statement: '獨立評分，不接受品牌付費改分。',
    campaign: '包裝負責說故事。FACTA 負責看證據。',
    scan_product: '掃描商品',
    photo_ingredients: '拍攝成分表',
    recent_scans: '最近掃描',
    dashboard_stats: '資料庫統計',
    products_verified: '已驗證商品',
    total_scans: '總掃描次數',
    pending_reviews: '待審核',
    demo_report: 'FACTA 報告預覽',
    
    // Scanner
    scanning: '掃描中...',
    camera_denied: '無法存取相機',
    manual_input: '手動輸入條碼',
    flashlight: '手電筒',

    // Report
    score: 'FACTA 評分',
    grade_excellent: '優良',
    grade_good: '良好',
    grade_consider: '需斟酌',
    grade_poor: '不建議',
    nutrition: '營養價值',
    additives: '添加物',
    personal_alerts: '個人化警示',
    verified: '已驗證',
    provisional: '初步評估',
    incomplete: '資料不全',
    better_alternatives: '更好的選擇',
    share_card: '分享報告',
    report_error: '回報錯誤',

    // Alternatives
    no_alternatives: '目前沒有足夠資料做出可靠推薦',
    price_diff: '價差',
    sugar_reduction: '減糖',

    // Preferences
    preferences: '個人偏好',
    allergens: '過敏原',
    dietary: '飲食偏好',
    save_preferences: '儲存偏好',

    // Submit
    submit_product: '提交新商品',
    product_name: '商品名稱',
    brand: '品牌',
    barcode: '條碼',
    photo_capture: '拍攝照片',
    ocr_processing: '正在讀取標示',
    ocr_comparing: '正在比對成分',
    confirm_text: '確認文字',
    submit_confirm: '提交審核',

    // History
    history: '掃描歷史',
    no_history: '尚未有掃描紀錄',
    scan_now: '立即掃描',

    // Admin
    admin_panel: '管理員後台',
    pending_queue: '待審核列表',
    corrections: '錯誤回報',
    edit_products: '商品管理',
    approve: '核准',
    reject: '退回',
  },
  en: {
    app_name: 'FACTA',
    tagline_en: 'Every choice deserves evidence.',
    tagline_zh: '每個選擇，都值得有證據。',
    trust_statement: 'Independent by design. No paid rankings.',
    campaign: 'Brands make claims. FACTA checks the evidence.',
    scan_product: 'Scan Product',
    photo_ingredients: 'Photo Ingredients',
    recent_scans: 'Recent Scans',
    dashboard_stats: 'Database Stats',
    products_verified: 'Verified Products',
    total_scans: 'Total Scans',
    pending_reviews: 'Pending Reviews',
    demo_report: 'FACTA Report Preview',

    // Scanner
    scanning: 'Scanning...',
    camera_denied: 'Camera permission denied',
    manual_input: 'Manual input',
    flashlight: 'Flashlight',

    // Report
    score: 'FACTA Score',
    grade_excellent: 'Excellent',
    grade_good: 'Good',
    grade_consider: 'Consider',
    grade_poor: 'Poor',
    nutrition: 'Nutrition',
    additives: 'Additives',
    personal_alerts: 'Personal Alerts',
    verified: 'Verified',
    provisional: 'Provisional',
    incomplete: 'Incomplete',
    better_alternatives: 'Better alternatives',
    share_card: 'Share Card',
    report_error: 'Report error',

    // Alternatives
    no_alternatives: 'Not enough data for reliable recommendations yet.',
    price_diff: 'Price diff',
    sugar_reduction: 'Sugar reduction',

    // Preferences
    preferences: 'Preferences',
    allergens: 'Allergens',
    dietary: 'Dietary',
    save_preferences: 'Save Preferences',

    // Submit
    submit_product: 'Submit Product',
    product_name: 'Product Name',
    brand: 'Brand',
    barcode: 'Barcode',
    photo_capture: 'Capture Photos',
    ocr_processing: 'Reading labels...',
    ocr_comparing: 'Comparing ingredients...',
    confirm_text: 'Confirm Text',
    submit_confirm: 'Submit for Review',

    // History
    history: 'Scan History',
    no_history: 'No scan history yet',
    scan_now: 'Scan Now',

    // Admin
    admin_panel: 'Admin Panel',
    pending_queue: 'Pending Queue',
    corrections: 'Corrections',
    edit_products: 'Manage Products',
    approve: 'Approve',
    reject: 'Reject',
  }
};

type Translations = typeof translations.zh;
type I18nContextType = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: keyof Translations) => string;
};

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem('facta_lang');
    return (saved as Lang) || 'zh';
  });

  useEffect(() => {
    localStorage.setItem('facta_lang', lang);
  }, [lang]);

  const t = (key: keyof Translations) => {
    return translations[lang][key] || translations['zh'][key] || key;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useTranslation must be used within I18nProvider');
  return context;
}
