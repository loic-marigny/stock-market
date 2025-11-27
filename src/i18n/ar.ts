import type { Translations } from "./lang";
import en from "./eng";

const ar: Translations = {
  ...en,
  "app.loading": "جارٍ التحميل...",
  "app.calculating": "يتم الحساب...",
  "nav.explore": "استكشاف",
  "nav.portfolio": "محفظة",
  "nav.trade": "تداول",
  "nav.totalValueLabel": "القيمة الإجمالية",
  "nav.signOut": "تسجيل الخروج",
  "nav.languageLabel": "اللغة",
  "nav.availableCash": "سيولة متاحة: ${{amount}}",
  "language.switch": "التبديل إلى {{language}}",
  "auth.subtitle": "تدرّب على الاستثمار باستخدام أرصدة افتراضية",
  "auth.title.signIn": "تسجيل الدخول",
  "auth.title.createAccount": "إنشاء حساب",
  "auth.label.email": "البريد الإلكتروني",
  "auth.label.password": "كلمة المرور",
  "auth.actions.signIn": "تسجيل الدخول",
  "auth.actions.createAccount": "إنشاء حساب",
  "auth.actions.createMyAccount": "إنشاء حسابي",
  "auth.toggle.newHere": "أول مرة هنا؟",
  "auth.toggle.alreadyRegistered": "هل لديك حساب؟",
  "auth.toggle.createAccount": "إنشاء حساب",
  "auth.toggle.signIn": "تسجيل الدخول",
  "auth.validation.missingCredentials": "يرجى إدخال البريد الإلكتروني وكلمة المرور.",
  "auth.errors.invalidEmail": "عنوان البريد الإلكتروني غير صالح.",
  "auth.errors.missingPassword": "كلمة المرور مطلوبة.",
  "auth.errors.weakPassword": "كلمة المرور قصيرة جدًا (الحد الأدنى 6 أحرف).",
  "auth.errors.emailInUse": "البريد الإلكتروني مستخدم بالفعل.",
  "auth.errors.invalidCredential": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  "auth.errors.tooManyRequests": "طلبات كثيرة جدًا. حاول لاحقًا.",
  "auth.footer.note": "© {{year}} ستوك ماركت - جميع الحقوق محفوظة",
  "portfolio.title": "محفظتي",
  "portfolio.cards.cash": "السيولة (USD)",
  "portfolio.cards.positionValue": "قيمة المراكز",
  "portfolio.cards.totalValue": "القيمة الإجمالية",
  "portfolio.currency.unit": "USD",
  "portfolio.table.headers.company": "الشركة",
  "portfolio.table.headers.symbol": "الرمز",
  "portfolio.table.headers.qty": "الكمية",
  "portfolio.table.headers.buyPrice": "سعر الشراء",
  "portfolio.table.headers.buyValue": "قيمة الشراء",
  "portfolio.table.headers.buyDate": "تاريخ الشراء",
  "portfolio.table.headers.avgPrice": "متوسط السعر",
  "portfolio.table.headers.last": "آخر سعر",
  "portfolio.table.headers.value": "القيمة",
  "portfolio.table.headers.pnl": "الربح / الخسارة",
  "portfolio.table.loading": "جارٍ الحساب...",
  "portfolio.table.empty": "لا توجد مراكز بعد.",
  "portfolio.help.cash":
    "المبلغ المتاح فورًا لتنفيذ عمليات الشراء.",
  "portfolio.help.positionValue":
    "مجموع قيم المراكز الحالية (آخر سعر × الكمية).",
  "portfolio.help.totalValue":
    "السيولة إضافة إلى القيمة السوقية لجميع المراكز.",
  "portfolio.help.company": "اسم الشركة ورمزها.",
  "portfolio.help.qty": "عدد الأسهم أو الوحدات المحتفظ بها.",
  "portfolio.help.avgPrice": "السعر المتوسط لكل سهم/وحدة.",
  "portfolio.help.buyPrice": "سعر الشراء لهذا اللوت.",
  "portfolio.help.buyValue": "المبلغ المستثمر (الكمية × سعر الشراء).",
  "portfolio.help.buyDate": "تاريخ ووقت تنفيذ الشراء.",
  "portfolio.help.last": "آخر سعر متاح في السوق.",
  "portfolio.help.value": "القيمة الحالية للسطر (السعر × الكمية).",
  "portfolio.help.pnl":
    "ربح أو خسارة غير محققة: (آخر سعر − متوسط السعر) × الكمية. تُعرض النسبة بين قوسين.",
  "portfolio.hint":
    "الأسعار تأتي من مزود JSON يتم تحديثه بواسطة السكربتات.",
  "portfolio.composition.title": "توزيع المحفظة",
  "portfolio.composition.others": "أخرى",
  "portfolio.composition.note": "باستثناء السيولة",
  "portfolio.composition.cash": "السيولة",
  "portfolio.composition.withCash.title": "المحفظة (مع السيولة)",
  "portfolio.composition.withCash.note": "تشمل السيولة",
  "portfolio.history.title": "تاريخ الثروة",
  "portfolio.history.note": "تفصيل الأسهم + السيولة (بيانات فعلية)",
  "portfolio.history.stocks": "الأسهم",
  "portfolio.history.cash": "السيولة",
  "trade.title": "التداول",
  "trade.field.symbol": "الرمز",
  "trade.field.inPortfolio": "في المحفظة",
  "trade.field.lastPrice": "آخر سعر",
  "trade.mode.enterQuantity": "إدخال الكمية",
  "trade.mode.enterAmount": "إدخال المبلغ",
  "trade.field.quantityLabel": "الكمية (وحدات)",
  "trade.field.estimatedCost": "الكلفة التقديرية",
  "trade.field.amountLabel": "المبلغ (أرصدة)",
  "trade.field.estimatedQuantity": "الكمية التقديرية",
  "trade.field.creditsLabel": "الأرصدة المتاحة",
  "trade.actions.buy": "شراء",
  "trade.actions.sell": "بيع",
  "trade.hint.quantity":
    "التنفيذ: الكمية × آخر سعر في لحظة الضغط.",
  "trade.hint.amount":
    "التنفيذ: الكمية المحسوبة = المبلغ ÷ آخر سعر.",
  "trade.validation.invalidPrice": "السعر غير متاح حاليًا. حاول لاحقًا.",
  "trade.validation.invalidQuantity": "كمية أو مبلغ غير صالح.",
  "trade.validation.insufficientPosition":
    "لا يوجد ما يكفي من الأسهم لتغطية هذه الكمية.",
  "trade.validation.insufficientCash":
    "لا توجد أرصدة كافية لهذه العملية.",
  "trade.success.buy": "تم تنفيذ أمر الشراء.",
  "trade.success.sell": "تم تنفيذ أمر البيع.",
  "explore.lastLabel": "آخر سعر:",
  "explore.markets": "الأسواق",
  "explore.hideSidebar": "إخفاء القائمة",
  "explore.searchPlaceholder": "بحث عن رمز أو اسم",
  "explore.showSidebar": "إظهار لوحة الأسواق",
  "explore.showList": "الأسواق",
  "explore.noResults": "لا توجد نتائج",
  "explore.metrics.title": "المؤشرات الرئيسية",
  "explore.metrics.beta": "بيتا",
  "explore.metrics.beta.help":
    "قياس لتذبذب السهم مقارنة بالسوق (1 = نفس التذبذب).",
  "explore.metrics.auditRisk": "مخاطر التدقيق",
  "explore.metrics.auditRisk.help":
    "درجة مخاطر التدقيق (0 = منخفض، 10 = مرتفع).",
  "explore.metrics.recommendationMean": "متوسط التوصيات",
  "explore.metrics.recommendationMean.help":
    "متوسط تقييم المحللين (1 = شراء قوي، 5 = بيع).",
  "explore.metrics.marketCap": "القيمة السوقية",
  "explore.metrics.marketCap.help":
    "آخر قيمة سوقية مُعلنة.",
  "explore.metrics.fiftyTwoWeeksHigh": "أعلى سعر خلال 52 أسبوعًا",
  "explore.metrics.fiftyTwoWeeksHigh.help":
    "أعلى سعر إغلاق خلال العام الماضي.",
  "explore.metrics.fiftyTwoWeeksLow": "أدنى سعر خلال 52 أسبوعًا",
  "explore.metrics.fiftyTwoWeeksLow.help":
    "أدنى سعر إغلاق خلال العام الماضي.",
  "explore.metrics.allTimeHigh": "أعلى سعر تاريخيًا",
  "explore.metrics.allTimeHigh.help":
    "أعلى سعر إغلاق مسجَّل.",
  "explore.metrics.allTimeLow": "أدنى سعر تاريخيًا",
  "explore.metrics.allTimeLow.help":
    "أدنى سعر إغلاق مسجَّل.",
  "explore.metrics.trailingPE": "مكرر الربحية (TTM)",
  "explore.metrics.trailingPE.help":
    "مكرر السعر إلى الربحية للأشهر الـ12 الماضية.",
  "explore.metrics.trailingEPS": "ربحية السهم (TTM)",
  "explore.metrics.trailingEPS.help":
    "ربحية السهم للأشهر الـ12 الماضية.",
  "explore.metrics.totalRevenue": "إجمالي الإيرادات",
  "explore.metrics.totalRevenue.help":
    "إيرادات آخر 12 شهرًا.",
  "explore.metrics.totalDebt": "إجمالي الديون",
  "explore.metrics.totalDebt.help":
    "آخر قيمة معلنة للديون.",
  "explore.metrics.totalCash": "إجمالي النقد",
  "explore.metrics.totalCash.help":
    "آخر قيمة معلنة للنقد والمعادلات النقدية.",
  "explore.metrics.freeCashflow": "التدفق النقدي الحر",
  "explore.metrics.freeCashflow.help":
    "التدفق النقدي الحر خلال 12 شهرًا الماضية.",
  "explore.metrics.operatingCashflow": "التدفق النقدي التشغيلي",
  "explore.metrics.operatingCashflow.help":
    "التدفق النقدي التشغيلي خلال 12 شهرًا الماضية.",
  "explore.metrics.displayName": "اسم العرض",
  "explore.metrics.displayName.help":
    "الاسم المفضل لعرض الأداة.",
  "explore.metrics.sectorDisplay": "القطاع",
  "explore.metrics.sectorDisplay.help":
    "الوصف القطاعي المعلن.",
  "explore.metrics.fiftyTwoWeeksRange": "نطاق 52 أسبوعًا",
  "explore.metrics.fiftyTwoWeeksRange.help":
    "مكان السعر الحالي بين أدنى وأعلى سعر خلال 52 أسبوعًا.",
  "explore.metrics.allTimeRange": "النطاق التاريخي",
  "explore.metrics.allTimeRange.help":
    "مكان السعر الحالي مقارنة بالحدود التاريخية.",

  "trade.schedule.title": "جدولة الأوامر",
  "trade.schedule.description":
    "ضع أمر شراء أو بيع تلقائيًا عند وصول السعر إلى حدك.",
  "trade.schedule.field.side": "نوع الأمر",
  "trade.schedule.field.qty": "الكمية المراد تداولها",
  "trade.schedule.field.amount": "المبلغ المراد إنفاقه",
  "trade.schedule.field.triggerPrice": "سعر التفعيل",
  "trade.schedule.field.triggerType": "شرط التفعيل",
  "trade.schedule.side.buy": "شراء",
  "trade.schedule.side.sell": "بيع",
  "trade.schedule.triggerType.gte": "السعر أكبر أو يساوي",
  "trade.schedule.triggerType.lte": "السعر أقل أو يساوي",
  "trade.schedule.submit": "جدولة الأمر",
  "trade.schedule.success": "تمت جدولة الأمر الشرطي.",
  "trade.schedule.validation.triggerPrice":
    "أدخل سعر تفعيل أكبر من صفر.",
  "trade.schedule.validation.qty": "أدخل كمية صالحة.",
  "trade.schedule.validation.position":
    "لا تملك كمية كافية لتغطية هذا الأمر.",
  "trade.schedule.validation.cash":
    "لا توجد أرصدة كافية لتغطية أمر الشراء إذا تفعّل.",
  "trade.schedule.orders.title": "الأوامر المجدولة",
  "trade.schedule.orders.empty": "لا توجد أوامر شرطية بعد.",
  "trade.schedule.orders.cancel": "إلغاء",
  "trade.schedule.status.pending": "قيد الانتظار",
  "trade.schedule.status.executing": "قيد التنفيذ",
  "trade.schedule.status.triggered": "تم التفعيل",
  "trade.schedule.status.cancelled": "أُلغي",
  "trade.schedule.status.error": "خطأ",
};

export default ar;
