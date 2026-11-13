-- Staging-only assessment coverage extension.
-- Adds draft-only items for under-assessed modules M05, M07 and M12.
-- Every item is linked to an existing source-page hash. No item is piloted,
-- psychometrically validated, approved, or executable by this migration.
INSERT OR IGNORE INTO gs_nds_assessment_items (
  item_id,module_id,source_id,source_document_id,source_url,page_number,
  source_page_sha256,question_fa,options_json,correct_option,explanation_fa,
  cognitive_level,difficulty_estimate,content_review_status,psychometric_status,
  pilot_status,metadata_json,created_at
)
SELECT
  'NDS-Q026','NDS-M05',c.source_id,d.source_document_id,d.source_url,c.page_number,
  c.content_sha256,
  'طبق شرح Rally 1 و Rally 2 در منبع فارسی، پس از Rally 1 معمولاً چه ساختاری پیش از آغاز Rally 2 دیده می‌شود؟',
  '[{"option":"A","text":"دو قله و دو دره در موج اصلاحی"},{"option":"B","text":"سه قله بالاتر بدون هیچ اصلاحی"},{"option":"C","text":"بسته‌شدن قطعی چرخه در همان نقطه"},{"option":"D","text":"یک گپ قیمتی الزامی"}]',
  'A',
  'منبع پس از Rally 1 از موج اصلاحی شامل دو قله و دو دره یاد می‌کند و سپس آغاز Rally 2 را شرح می‌دهد؛ واژه معمولاً به معنی وقوع قطعی در همه بازارها نیست.',
  'understand','medium','draft_content_review','not_piloted','not_piloted',
  '{"source_exact_page_hash":true,"psychometric_validity":false,"review_note":"Source describes a typical sequence, not a guaranteed invariant."}',
  '2026-11-10T00:00:00Z'
FROM gs_source_chunks c JOIN gs_source_documents d ON d.source_id=c.source_id
WHERE c.source_id='academia-nds-farsi' AND c.page_number=28
  AND c.content_sha256='925f5677c887596747819cee2f76962e102bf0f46479f0c016bbc8ff11b299a8';

INSERT OR IGNORE INTO gs_nds_assessment_items (
  item_id,module_id,source_id,source_document_id,source_url,page_number,
  source_page_sha256,question_fa,options_json,correct_option,explanation_fa,
  cognitive_level,difficulty_estimate,content_review_status,psychometric_status,
  pilot_status,metadata_json,created_at
)
SELECT
  'NDS-Q027','NDS-M05',c.source_id,d.source_document_id,d.source_url,c.page_number,
  c.content_sha256,
  'در شماتیک Dropها، منبع وضعیت قیمت میان دو لگ نزولی قدرتمند Drop 1 و Drop 2 را چگونه توصیف می‌کند؟',
  '[{"option":"A","text":"حرکت صعودی پیوسته و بدون توقف"},{"option":"B","text":"تراکم یا حرکت خنثی (Consolidation)"},{"option":"C","text":"تشکیل اجباری سه کف پایین‌تر"},{"option":"D","text":"پایان قطعی روند نزولی بدون اصلاح"}]',
  'B',
  'در صفحه مربوط به Bearish Rallies (Drops)، منبع حرکت خنثی/تراکم میان دو لگ نزولی را نشان می‌دهد و ادامه حرکت را به‌صورت الگوی معمول توصیف می‌کند، نه قانون تضمینی.',
  'understand','medium','draft_content_review','not_piloted','not_piloted',
  '{"source_exact_page_hash":true,"psychometric_validity":false,"review_note":"Typical schematic sequence; not a deterministic market law."}',
  '2026-11-10T00:00:00Z'
FROM gs_source_chunks c JOIN gs_source_documents d ON d.source_id=c.source_id
WHERE c.source_id='academia-nds-farsi' AND c.page_number=31
  AND c.content_sha256='e34c3a09d6deb80626451dbfe2549efec648ea053c746a14f6dcb1f7de5b7750';

INSERT OR IGNORE INTO gs_nds_assessment_items (
  item_id,module_id,source_id,source_document_id,source_url,page_number,
  source_page_sha256,question_fa,options_json,correct_option,explanation_fa,
  cognitive_level,difficulty_estimate,content_review_status,psychometric_status,
  pilot_status,metadata_json,created_at
)
SELECT
  'NDS-Q028','NDS-M07',c.source_id,d.source_document_id,d.source_url,c.page_number,
  c.content_sha256,
  'در مثال جزء‌به‌کل منبع، یک چرخه کامل در تایم‌فریم بالاتر چگونه بازنمایی می‌شود؟',
  '[{"option":"A","text":"سه قله و یک فلگ"},{"option":"B","text":"فقط یک خط روند بدون نود"},{"option":"C","text":"دوازده چرخه کوچک با تعداد ثابت"},{"option":"D","text":"دو کف هم‌سطح و بدون حرکت اصلاحی"}]',
  'A',
  'منبع توضیح می‌دهد که با نگاه از مقیاس بالاتر، یک چرخه کامل می‌تواند به شکل سه قله و یک فلگ دیده شود؛ این بازنمایی وابسته به مقیاس و مثال منبع است.',
  'understand','medium','draft_content_review','not_piloted','not_piloted',
  '{"source_exact_page_hash":true,"psychometric_validity":false,"review_note":"Do not generalize the schematic into a universal fixed-count rule."}',
  '2026-11-10T00:00:00Z'
FROM gs_source_chunks c JOIN gs_source_documents d ON d.source_id=c.source_id
WHERE c.source_id='academia-nds-farsi' AND c.page_number=45
  AND c.content_sha256='69de4da9eeacd4c513f1a1caece6b767f540a804a746e412f45f0353e29e029e';

INSERT OR IGNORE INTO gs_nds_assessment_items (
  item_id,module_id,source_id,source_document_id,source_url,page_number,
  source_page_sha256,question_fa,options_json,correct_option,explanation_fa,
  cognitive_level,difficulty_estimate,content_review_status,psychometric_status,
  pilot_status,metadata_json,created_at
)
SELECT
  'NDS-Q029','NDS-M07',c.source_id,d.source_document_id,d.source_url,c.page_number,
  c.content_sha256,
  'کدام برداشت از رابطه ساختارهای کوچک و بزرگ با توضیح فراکتالی منبع سازگارتر است؟',
  '[{"option":"A","text":"ساختار کوچک می‌تواند در ساختار بزرگ‌تر نقش داشته باشد و از جزء به کل تحلیل شود"},{"option":"B","text":"ساختارهای کوچک مستقل از ساختارهای بزرگ‌اند"},{"option":"C","text":"تعداد چرخه‌های کوچک در هر چرخه بزرگ همیشه ثابت است"},{"option":"D","text":"فقط تحلیل از تایم‌فریم پایین به بالا مجاز است"}]',
  'A',
  'صفحه فراکتال هم نگاه کل‌به‌جزء و هم جزء‌به‌کل را توضیح می‌دهد؛ تعداد ثابت برای چرخه‌های کوچک از آن نتیجه نمی‌شود.',
  'analyze','hard','draft_content_review','not_piloted','not_piloted',
  '{"source_exact_page_hash":true,"psychometric_validity":false,"review_note":"Distractors test overgeneralization of the source example."}',
  '2026-11-10T00:00:00Z'
FROM gs_source_chunks c JOIN gs_source_documents d ON d.source_id=c.source_id
WHERE c.source_id='academia-nds-farsi' AND c.page_number=36
  AND c.content_sha256='74039efb5991b8653225290b2c319cef6b2687a53a8d5fb2846e6ec00d46ae0b';

INSERT OR IGNORE INTO gs_nds_assessment_items (
  item_id,module_id,source_id,source_document_id,source_url,page_number,
  source_page_sha256,question_fa,options_json,correct_option,explanation_fa,
  cognitive_level,difficulty_estimate,content_review_status,psychometric_status,
  pilot_status,metadata_json,created_at
)
SELECT
  'NDS-Q030','NDS-M12',c.source_id,d.source_document_id,d.source_url,c.page_number,
  c.content_sha256,
  'در مقاله AI+NDS، نقش Random Forest در طرح پیشنهادی چگونه بیان شده است؟',
  '[{"option":"A","text":"مدل‌سازی یا اصلاح باقیمانده‌های تابع روند در چارچوب پیشنهادی"},{"option":"B","text":"جایگزینی کامل داده‌های بازار با داده ساختگی"},{"option":"C","text":"حذف نیاز به تعریف نودها و جابه‌جایی آن‌ها"},{"option":"D","text":"تضمین سودآوری مستقل از هزینه معامله"}]',
  'A',
  'چکیده مقاله از تابع روند و بازخورد اختلاف مقدار واقعی و پیش‌بینی‌شده صحبت می‌کند؛ این توصیف طرح پیشنهادی است و اثبات عملکرد بهتر یا سودآوری نیست.',
  'understand','medium','draft_content_review','not_piloted','not_piloted',
  '{"source_exact_page_hash":true,"psychometric_validity":false,"review_note":"Tests faithful reading; does not endorse predictive claims."}',
  '2026-11-10T00:00:00Z'
FROM gs_source_chunks c JOIN gs_source_documents d ON d.source_id=c.source_id
WHERE c.source_id='academia-nds-ai-quant' AND c.page_number=1
  AND c.content_sha256='cafa890379a29817052fe74375384ec9355a451727bf37f15c61787ec28ba154';

INSERT OR IGNORE INTO gs_nds_assessment_items (
  item_id,module_id,source_id,source_document_id,source_url,page_number,
  source_page_sha256,question_fa,options_json,correct_option,explanation_fa,
  cognitive_level,difficulty_estimate,content_review_status,psychometric_status,
  pilot_status,metadata_json,created_at
)
SELECT
  'NDS-Q031','NDS-M12',c.source_id,d.source_document_id,d.source_url,c.page_number,
  c.content_sha256,
  'پیش از پذیرش ادعای بهبود پیش‌بینی در یک مدل AI+NDS، کدام مدرک برای اعتبارسنجی مستقل ضروری‌تر است؟',
  '[{"option":"A","text":"فقط عنوان مقاله و نام الگوریتم"},{"option":"B","text":"داده و ویژگی‌های قابل بازتولید، تقسیم زمانی بدون نشت اطلاعات، معیار مقایسه و آزمون خارج از نمونه"},{"option":"C","text":"یک نمودار منتخب که با مدل سازگار باشد"},{"option":"D","text":"افزایش تعداد پارامترها تا رسیدن به نتیجه مطلوب"}]',
  'B',
  'این پرسش یک مهارت ارزیابی پژوهش است: ادعای عملکرد باید با داده، روش قابل بازتولید، جلوگیری از نشت آینده، خط مبنا و آزمون خارج از نمونه سنجیده شود؛ صرف شبه‌کد یا انتخاب الگوریتم کافی نیست.',
  'evaluate','hard','draft_content_review','not_piloted','not_piloted',
  '{"source_exact_page_hash":true,"psychometric_validity":false,"review_note":"Critical appraisal item aligned with M12 competency; answer is methodological evaluation, not a quoted source rule."}',
  '2026-11-10T00:00:00Z'
FROM gs_source_chunks c JOIN gs_source_documents d ON d.source_id=c.source_id
WHERE c.source_id='academia-nds-ai-quant' AND c.page_number=6
  AND c.content_sha256='460b6df3d186ef3d658da3a9b3354983eade7dd4c92e6ec4f7ffca3df57791c5';
