import React, { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { useTranslation } from "@/lib/i18n";
import {
  useDeletePreferences,
  useGetPreferences,
  useSavePreferences,
  type HouseholdMember,
} from "@workspace/api-client-react";
import { getSessionId } from "@/lib/session";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const ALLERGEN_OPTIONS = [
  { id: "milk", label: "Milk", labelZh: "乳" },
  { id: "egg", label: "Egg", labelZh: "蛋" },
  { id: "peanut", label: "Peanut", labelZh: "花生" },
  { id: "treenut", label: "Tree Nuts", labelZh: "堅果" },
  { id: "sesame", label: "Sesame", labelZh: "芝麻" },
  { id: "soy", label: "Soy", labelZh: "大豆" },
  { id: "wheat", label: "Wheat / Gluten", labelZh: "小麥／麩質" },
  { id: "fish", label: "Fish", labelZh: "魚" },
  { id: "shellfish", label: "Shellfish", labelZh: "甲殼類" },
];

const DIETARY_OPTIONS = [
  { id: "vegan", label: "Vegan", labelZh: "純素" },
  { id: "vegetarian", label: "Ovo-Lacto Vegetarian", labelZh: "蛋奶素" },
  { id: "halal", label: "Halal", labelZh: "清真" },
  { id: "kosher", label: "Kosher", labelZh: "猶太潔食" },
];

const HABIT_OPTIONS = [
  { id: "low_sugar", label: "Reduce sugar", labelZh: "少糖" },
  { id: "low_sodium", label: "Reduce sodium", labelZh: "少鈉" },
  { id: "avoid_caffeine", label: "Avoid caffeine", labelZh: "避免咖啡因" },
  {
    id: "less_processed",
    label: "Fewer processed ingredients",
    labelZh: "少加工",
  },
];

const RELATIONSHIP_LABELS: Record<HouseholdMember["relationship"], string> = {
  partner: "伴侶",
  child: "孩子",
  parent: "父母",
  other: "其他家人",
};

function splitTerms(value: string): string[] {
  return value
    .split(/[,，、;；\n]/)
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term, index, all) => all.indexOf(term) === index)
    .slice(0, 30);
}

function ChoiceButton({
  active,
  onClick,
  label,
  warning = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  warning?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-11 px-3 py-2.5 border-2 flex items-center justify-between gap-2 text-sm font-bold text-left transition-colors",
        active &&
          warning &&
          "border-destructive bg-destructive/10 text-destructive",
        active && !warning && "border-foreground bg-foreground text-background",
        !active &&
          "border-border bg-background text-foreground hover:border-muted-foreground",
      )}
    >
      <span>{label}</span>
      {active && <Check className="w-4 h-4 shrink-0" />}
    </button>
  );
}

function ChoiceGrid({
  options,
  values,
  onChange,
  lang,
  warning = false,
}: {
  options: Array<{ id: string; label: string; labelZh: string }>;
  values: string[];
  onChange: (values: string[]) => void;
  lang: "zh" | "en";
  warning?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((option) => {
        const active = values.includes(option.id);
        return (
          <ChoiceButton
            key={option.id}
            active={active}
            warning={warning}
            label={lang === "zh" ? option.labelZh : option.label}
            onClick={() =>
              onChange(
                active
                  ? values.filter((value) => value !== option.id)
                  : [...values, option.id],
              )
            }
          />
        );
      })}
    </div>
  );
}

function TermInput({
  values,
  onChange,
  placeholder,
  className,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  className?: string;
}) {
  const [text, setText] = useState(values.join("、"));

  useEffect(() => {
    const localTerms = splitTerms(text);
    if (localTerms.join("\u0000") !== values.join("\u0000")) {
      setText(values.join("、"));
    }
  }, [values]);

  return (
    <input
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(splitTerms(event.target.value));
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}

function conditionCount(
  member: Pick<
    HouseholdMember,
    "allergens" | "dietaryPreferences" | "avoidIngredients" | "habits" | "notes"
  >,
): number {
  return (
    member.allergens.length +
    member.dietaryPreferences.length +
    member.avoidIngredients.length +
    member.habits.length +
    (member.notes?.trim() ? 1 : 0)
  );
}

export default function Preferences() {
  const { lang, setLang } = useTranslation();
  const sessionId = getSessionId();
  const { toast } = useToast();

  const { data: prefData, isLoading } = useGetPreferences(sessionId, {
    query: { enabled: !!sessionId, retry: false } as any,
  });
  const savePreferences = useSavePreferences();
  const deletePreferences = useDeletePreferences();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [allergens, setAllergens] = useState<string[]>([]);
  const [dietary, setDietary] = useState<string[]>([]);
  const [habits, setHabits] = useState<string[]>([]);
  const [avoidIngredients, setAvoidIngredients] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>(
    [],
  );
  const [personalizationEnabled, setPersonalizationEnabled] = useState(false);
  const [localLang, setLocalLang] = useState<"zh" | "en">(lang);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);

  useEffect(() => {
    if (!prefData) return;
    setDisplayName(prefData.displayName || "");
    setEmail(prefData.email || "");
    setAllergens(prefData.allergens || []);
    setDietary(prefData.dietaryPreferences || []);
    setHabits(prefData.habits || []);
    setAvoidIngredients(prefData.avoidIngredients || []);
    setNotes(prefData.notes || "");
    setHouseholdMembers(prefData.householdMembers || []);
    setPersonalizationEnabled(prefData.personalizationEnabled);
    const savedLang = prefData.locale?.toLowerCase().startsWith("zh")
      ? "zh"
      : "en";
    setLocalLang(savedLang);
    setLang(savedLang);
  }, [prefData, setLang]);

  const primaryConditionCount =
    allergens.length +
    dietary.length +
    habits.length +
    avoidIngredients.length +
    (notes.trim() ? 1 : 0);
  const totalConditionCount =
    primaryConditionCount +
    householdMembers.reduce(
      (total, member) => total + conditionCount(member),
      0,
    );
  const hasProfileData = Boolean(
    displayName.trim() ||
    email.trim() ||
    totalConditionCount ||
    householdMembers.length,
  );
  const validEmail =
    !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const namedMembers = householdMembers.every(
    (member) => member.name.trim().length > 0,
  );
  const canSave =
    validEmail && namedMembers && (!hasProfileData || personalizationEnabled);

  const lastUpdated = useMemo(() => {
    if (!prefData?.updatedAt) return null;
    return new Date(prefData.updatedAt).toLocaleString("zh-TW", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }, [prefData?.updatedAt]);

  const updateMember = (id: string, patch: Partial<HouseholdMember>) => {
    setHouseholdMembers((current) =>
      current.map((member) =>
        member.id === id ? { ...member, ...patch } : member,
      ),
    );
  };

  const addMember = () => {
    if (householdMembers.length >= 6) {
      toast({ title: "最多可建立 6 位家人" });
      return;
    }
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `member-${Date.now()}`;
    const member: HouseholdMember = {
      id,
      name: "",
      relationship: "other",
      allergens: [],
      dietaryPreferences: [],
      avoidIngredients: [],
      habits: [],
      notes: null,
    };
    setHouseholdMembers((current) => [...current, member]);
    setExpandedMemberId(id);
    setPersonalizationEnabled(true);
  };

  const handleSave = async () => {
    if (!validEmail) {
      toast({ title: "Email 格式不正確", variant: "destructive" });
      return;
    }
    if (!namedMembers) {
      toast({ title: "請替每位家人填寫稱呼", variant: "destructive" });
      return;
    }
    if (hasProfileData && !personalizationEnabled) {
      toast({ title: "請先同意將資料用於個人化提醒", variant: "destructive" });
      return;
    }

    try {
      await savePreferences.mutateAsync({
        sessionId,
        data: {
          displayName: displayName.trim() || null,
          email: email.trim().toLowerCase() || null,
          allergens,
          dietaryPreferences: dietary,
          habits,
          avoidIngredients,
          notes: notes.trim() || null,
          householdMembers: householdMembers.map((member) => ({
            ...member,
            name: member.name.trim(),
            avoidIngredients: member.avoidIngredients
              .map((value) => value.trim())
              .filter(Boolean),
            notes: member.notes?.trim() || null,
          })),
          personalizationEnabled,
          locale: localLang,
        },
      });
      setLang(localLang);
      toast({
        title: "家庭食品檔案已更新",
        description: "下一份商品報告會直接套用這些最新條件。",
      });
    } catch {
      toast({ title: "目前無法儲存，請稍後再試", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(
      "確定刪除姓名、Email、本人與家人的所有食品偏好嗎？這不會刪除掃描紀錄。",
    );
    if (!confirmed) return;
    try {
      await deletePreferences.mutateAsync({ sessionId });
      setDisplayName("");
      setEmail("");
      setAllergens([]);
      setDietary([]);
      setHabits([]);
      setAvoidIngredients([]);
      setNotes("");
      setHouseholdMembers([]);
      setPersonalizationEnabled(false);
      toast({ title: "食品個人化資料已刪除" });
    } catch {
      toast({ title: "刪除失敗，請稍後再試", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="p-6 space-y-4 animate-pulse">
          <div className="h-8 bg-muted w-40" />
          <div className="h-28 bg-muted" />
          <div className="h-64 bg-muted" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col min-h-full pb-10 bg-card">
        <header className="p-6 pb-5 bg-background border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black tracking-widest text-primary-strong mb-2">
                給自己，也給家人
              </p>
              <h1 className="text-2xl font-black">家庭食品檔案</h1>
            </div>
            <Users className="w-6 h-6 text-primary-strong shrink-0" />
          </div>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            記下每個人的過敏原、飲食限制與習慣。FACTA
            每次開啟報告都會讀取你最後儲存的版本，客觀分數不會因此改變。
          </p>
          {lastUpdated && (
            <p className="text-[10px] font-bold text-muted-foreground mt-3">
              上次更新：{lastUpdated}
            </p>
          )}
        </header>

        <div className="p-6 flex flex-col gap-8 flex-1">
          <section className="bg-foreground text-background p-5 flex gap-3">
            <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-black">
                FACTA 記得的是你明確填寫的資料
              </h2>
              <p className="text-xs text-background/70 mt-1 leading-relaxed">
                不從掃描紀錄推定疾病，也不把備註當成醫療診斷。你可以隨時修改或刪除；Email
                目前不會建立登入或跨裝置同步。
              </p>
            </div>
          </section>

          <section className="space-y-5">
            <div>
              <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                本人
              </p>
              <h2 className="text-xl font-black mt-1">
                先讓提醒知道是在替誰看
              </h2>
            </div>
            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-bold">姓名或稱呼</span>
                <input
                  value={displayName}
                  onChange={(event) =>
                    setDisplayName(event.target.value.slice(0, 80))
                  }
                  placeholder="例如：小安"
                  autoComplete="name"
                  className="mt-2 w-full h-12 px-4 bg-background border-2 border-border focus:border-foreground outline-none text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold">Email（選填）</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value.slice(0, 254))
                  }
                  placeholder="name@example.com"
                  autoComplete="email"
                  aria-invalid={!validEmail}
                  className={cn(
                    "mt-2 w-full h-12 px-4 bg-background border-2 outline-none text-sm",
                    validEmail
                      ? "border-border focus:border-foreground"
                      : "border-destructive",
                  )}
                />
                {!validEmail && (
                  <span className="block text-xs text-destructive mt-1">
                    請輸入有效的 Email
                  </span>
                )}
                <span className="block text-[10px] text-muted-foreground mt-1">
                  先作為這份家庭檔案的聯絡資料；跨裝置同步需等帳號功能上線。
                </span>
              </label>
            </div>
          </section>

          <section className="space-y-6 border-t border-border pt-8">
            <div>
              <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                本人的飲食提醒
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                報告會標出衝突，但食物過敏仍須以實體包裝與醫療專業為準。
              </p>
            </div>
            <div className="space-y-3">
              <h3 className="text-xs font-black tracking-widest">過敏原</h3>
              <ChoiceGrid
                options={ALLERGEN_OPTIONS}
                values={allergens}
                onChange={setAllergens}
                lang={localLang}
                warning
              />
            </div>
            <div className="space-y-3">
              <h3 className="text-xs font-black tracking-widest">飲食方式</h3>
              <ChoiceGrid
                options={DIETARY_OPTIONS}
                values={dietary}
                onChange={setDietary}
                lang={localLang}
              />
            </div>
            <div className="space-y-3">
              <h3 className="text-xs font-black tracking-widest">日常習慣</h3>
              <ChoiceGrid
                options={HABIT_OPTIONS}
                values={habits}
                onChange={setHabits}
                lang={localLang}
              />
            </div>
            <label className="block">
              <span className="text-xs font-black tracking-widest">
                特別想避開的成分
              </span>
              <TermInput
                values={avoidIngredients}
                onChange={setAvoidIngredients}
                placeholder="例如：阿斯巴甜、咖啡因"
                className="mt-2 w-full h-12 px-4 bg-background border-2 border-border focus:border-foreground outline-none text-sm"
              />
              <span className="block text-[10px] text-muted-foreground mt-1">
                用逗號或頓號分開；只在成分表有明確文字時提醒。
              </span>
            </label>
            <label className="block">
              <span className="text-xs font-black tracking-widest">
                其他習慣或提醒（選填）
              </span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value.slice(0, 500))}
                placeholder="例如：晚上不喝含咖啡因飲料"
                rows={3}
                className="mt-2 w-full p-4 bg-background border-2 border-border focus:border-foreground outline-none text-sm resize-none"
              />
              <span className="block text-[10px] text-muted-foreground mt-1">
                FACTA 會保存備註供你查看，不會自行把自由文字推定成疾病。
              </span>
            </label>
          </section>

          <section className="space-y-4 border-t border-border pt-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black tracking-widest text-muted-foreground uppercase">
                  家人
                </p>
                <h2 className="text-xl font-black mt-1">
                  同一款食品，對每個人可能不同
                </h2>
              </div>
              <span className="text-xs font-bold text-muted-foreground shrink-0">
                {householdMembers.length}/6
              </span>
            </div>

            <div className="space-y-3">
              {householdMembers.map((member) => {
                const expanded = expandedMemberId === member.id;
                const memberConditions = conditionCount(member);
                return (
                  <article
                    key={member.id}
                    className="border-2 border-border bg-background"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedMemberId(expanded ? null : member.id)
                      }
                      aria-expanded={expanded}
                      className="w-full p-4 flex items-center justify-between gap-3 text-left"
                    >
                      <span>
                        <span className="block font-black text-sm">
                          {member.name || "尚未命名"}
                        </span>
                        <span className="block text-[10px] text-muted-foreground mt-1">
                          {RELATIONSHIP_LABELS[member.relationship]} ·{" "}
                          {memberConditions} 項條件
                        </span>
                      </span>
                      {expanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>

                    {expanded && (
                      <div className="p-4 pt-0 border-t border-border space-y-5">
                        <div className="grid grid-cols-2 gap-3 pt-4">
                          <label>
                            <span className="text-xs font-bold">稱呼</span>
                            <input
                              value={member.name}
                              onChange={(event) =>
                                updateMember(member.id, {
                                  name: event.target.value.slice(0, 80),
                                })
                              }
                              placeholder="例如：媽媽"
                              className="mt-2 w-full h-11 px-3 border-2 border-border bg-card focus:border-foreground outline-none text-sm"
                            />
                          </label>
                          <label>
                            <span className="text-xs font-bold">關係</span>
                            <select
                              value={member.relationship}
                              onChange={(event) =>
                                updateMember(member.id, {
                                  relationship: event.target
                                    .value as HouseholdMember["relationship"],
                                })
                              }
                              className="mt-2 w-full h-11 px-3 border-2 border-border bg-card focus:border-foreground outline-none text-sm"
                            >
                              {Object.entries(RELATIONSHIP_LABELS).map(
                                ([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                        </div>

                        <div className="space-y-3">
                          <h3 className="text-xs font-black tracking-widest">
                            過敏原
                          </h3>
                          <ChoiceGrid
                            options={ALLERGEN_OPTIONS}
                            values={member.allergens}
                            onChange={(values) =>
                              updateMember(member.id, { allergens: values })
                            }
                            lang={localLang}
                            warning
                          />
                        </div>
                        <div className="space-y-3">
                          <h3 className="text-xs font-black tracking-widest">
                            飲食方式
                          </h3>
                          <ChoiceGrid
                            options={DIETARY_OPTIONS}
                            values={member.dietaryPreferences}
                            onChange={(values) =>
                              updateMember(member.id, {
                                dietaryPreferences: values,
                              })
                            }
                            lang={localLang}
                          />
                        </div>
                        <div className="space-y-3">
                          <h3 className="text-xs font-black tracking-widest">
                            日常習慣
                          </h3>
                          <ChoiceGrid
                            options={HABIT_OPTIONS}
                            values={member.habits}
                            onChange={(values) =>
                              updateMember(member.id, { habits: values })
                            }
                            lang={localLang}
                          />
                        </div>
                        <label className="block">
                          <span className="text-xs font-black tracking-widest">
                            特別想避開的成分
                          </span>
                          <TermInput
                            values={member.avoidIngredients}
                            onChange={(values) =>
                              updateMember(member.id, {
                                avoidIngredients: values,
                              })
                            }
                            placeholder="例如：阿斯巴甜、咖啡因"
                            className="mt-2 w-full h-11 px-3 border-2 border-border bg-card focus:border-foreground outline-none text-sm"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs font-black tracking-widest">
                            其他習慣或提醒
                          </span>
                          <textarea
                            value={member.notes || ""}
                            onChange={(event) =>
                              updateMember(member.id, {
                                notes: event.target.value.slice(0, 500),
                              })
                            }
                            rows={2}
                            className="mt-2 w-full p-3 border-2 border-border bg-card focus:border-foreground outline-none text-sm resize-none"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setHouseholdMembers((current) =>
                              current.filter((item) => item.id !== member.id),
                            );
                            setExpandedMemberId(null);
                          }}
                          className="text-xs font-bold text-destructive flex items-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" /> 移除這位家人
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            <button
              type="button"
              onClick={addMember}
              className="w-full py-3.5 border-2 border-dashed border-foreground font-black text-sm flex items-center justify-center gap-2 hover:bg-muted"
            >
              <Plus className="w-4 h-4" /> 新增家人
            </button>
          </section>

          <section className="space-y-3 border-t border-border pt-8">
            <h2 className="text-xs font-black tracking-widest text-muted-foreground uppercase">
              介面語言
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <ChoiceButton
                active={localLang === "zh"}
                onClick={() => setLocalLang("zh")}
                label="中文（繁體）"
              />
              <ChoiceButton
                active={localLang === "en"}
                onClick={() => setLocalLang("en")}
                label="English"
              />
            </div>
          </section>

          <section
            className={cn(
              "border-2 p-4",
              hasProfileData && !personalizationEnabled
                ? "border-destructive bg-destructive/5"
                : "border-border bg-muted/40",
            )}
          >
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={personalizationEnabled}
                onChange={(event) =>
                  setPersonalizationEnabled(event.target.checked)
                }
                className="mt-0.5 w-5 h-5 accent-black shrink-0"
              />
              <span>
                <span className="block text-sm font-black">
                  同意儲存並套用這份家庭食品檔案
                </span>
                <span className="block text-xs text-muted-foreground mt-1 leading-relaxed">
                  FACTA
                  會在每份報告讀取最新版本，顯示對應成員的個人提醒；不改動商品客觀評分。
                </span>
              </span>
            </label>
          </section>
        </div>

        <div className="px-6 pb-6 space-y-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || savePreferences.isPending}
            className="w-full py-4 bg-primary text-primary-foreground font-black tracking-widest disabled:opacity-40"
          >
            {savePreferences.isPending
              ? "儲存中…"
              : `儲存最新家庭檔案${totalConditionCount ? `（${totalConditionCount} 項）` : ""}`}
          </button>
          {prefData && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deletePreferences.isPending}
              className="w-full py-3 text-xs font-bold text-destructive flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" /> 刪除食品個人化資料
            </button>
          )}
        </div>
      </div>
    </Layout>
  );
}
