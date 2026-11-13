-- Additional source-linked draft assessment coverage for symmetry, sequencing and checklist.
-- These remain unpiloted content-review items; no operational trading rules are created.
INSERT OR IGNORE INTO gs_nds_assessment_items (
 item_id,module_id,source_id,source_document_id,source_url,page_number,source_page_sha256,
 question_fa,options_json,correct_option,explanation_fa,cognitive_level,difficulty_estimate,
 content_review_status,psychometric_status,pilot_status,metadata_json,created_at
)
SELECT 'NDS-Q032','NDS-M08',c.source_id,d.source_document_id,d.source_url,c.page_number,c.content_sha256,
 'طبق رابطه تقارن قیمتی منبع، اگر A1=100، A2=120 و B1=200 پوینت باشد، مقدار B2 چقدر می‌شود؟',
 '[{"option":"A","text":"220 پوینت"},{"option":"B","text":"240 پوینت"},{"option":"C","text":"260 پوینت"},{"option":"D","text":"300 پوینت"}]',
 'B',
 'با فرمول B2=(A2×B1)/A1 داریم (120×200)/100=240 پوینت. این فقط بازتولید محاسبه مثال/رابطه منبع است و اعتبار پیش‌بینی بازار را ثابت نمی‌کند.',
 'apply','medium','draft_content_review','not_piloted','not_piloted',
 '{"source_exact_page_hash":true,"independent_arithmetic_check":true,"psychometric_validity":false,"unit":"points","review_note":"Mathematical calculation only; no market guarantee."}',
 '2026-11-10T00:00:00Z'
FROM gs_source_chunks c JOIN gs_source_documents d ON d.source_id=c.source_id
WHERE c.source_id='academia-nds-farsi' AND c.page_number=57
 AND c.content_sha256='4a9d5b73404ca74dae5983d5aadac59697f33276521c7107b1335c4601fc4975';

INSERT OR IGNORE INTO gs_nds_assessment_items (
 item_id,module_id,source_id,source_document_id,source_url,page_number,source_page_sha256,
 question_fa,options_json,correct_option,explanation_fa,cognitive_level,difficulty_estimate,
 content_review_status,psychometric_status,pilot_status,metadata_json,created_at
)
SELECT 'NDS-Q033','NDS-M08',c.source_id,d.source_document_id,d.source_url,c.page_number,c.content_sha256,
 'منبع درباره تکنیک تقارن قیمتی چه محدودیت صریحی بیان می‌کند؟',
 '[{"option":"A","text":"رسیدن قیمت به تارگت تضمین شده است"},{"option":"B","text":"تقارن کاملاً دقیق و بدون خطاست"},{"option":"C","text":"تقارن تقریبی است و رسیدن قیمت به تارگت تضمین ندارد"},{"option":"D","text":"فقط در بازارهای بدون نوسان کاربرد دارد"}]',
 'C',
 'صفحه 52 صریحاً می‌گوید تکنیک تقارن تقریبی است و هیچ تضمینی برای رسیدن قیمت به تارگت وجود ندارد.',
 'understand','easy','draft_content_review','not_piloted','not_piloted',
 '{"source_exact_page_hash":true,"psychometric_validity":false,"review_note":"Explicit limitation in source."}',
 '2026-11-10T00:00:00Z'
FROM gs_source_chunks c JOIN gs_source_documents d ON d.source_id=c.source_id
WHERE c.source_id='academia-nds-farsi' AND c.page_number=52
 AND c.content_sha256='8d8e824e0efa846149036af7f2f8fbe425b4db1bdfdfd219df9e12ab005149e6';

INSERT OR IGNORE INTO gs_nds_assessment_items (
 item_id,module_id,source_id,source_document_id,source_url,page_number,source_page_sha256,
 question_fa,options_json,correct_option,explanation_fa,cognitive_level,difficulty_estimate,
 content_review_status,psychometric_status,pilot_status,metadata_json,created_at
)
SELECT 'NDS-Q034','NDS-M09',c.source_id,d.source_document_id,d.source_url,c.page_number,c.content_sha256,
 'در توالی ایده‌آل هوک کامل که در فصل اولویت نودها آمده، ترتیب تشکیل نودها کدام است؟',
 '[{"option":"A","text":"High 1، High 2، High 3، سپس Low 1، Low 2، Low 3"},{"option":"B","text":"High 1، Low 1، High 2، Low 2، High 3، Low 3"},{"option":"C","text":"Low 1، Low 2، Low 3، سپس High 1، High 2، High 3"},{"option":"D","text":"هر ترتیبی قابل قبول است و اولویتی وجود ندارد"}]',
 'B',
 'منبع توالی ایده‌آل را به‌صورت تناوبی بیان می‌کند: نود 1 بالا، نود 1 پایین، نود 2 بالا، نود 2 پایین، نود 3 بالا و نود 3 پایین.',
 'understand','medium','draft_content_review','not_piloted','not_piloted',
 '{"source_exact_page_hash":true,"psychometric_validity":false,"review_note":"Tests ideal source sequence, not proof that markets always follow it."}',
 '2026-11-10T00:00:00Z'
FROM gs_source_chunks c JOIN gs_source_documents d ON d.source_id=c.source_id
WHERE c.source_id='academia-nds-farsi' AND c.page_number=94
 AND c.content_sha256='3fac50bb46ec9d3b77ea38a15026ee2a9c807d3f2df2427d2b0cb4f6c2092587';

INSERT OR IGNORE INTO gs_nds_assessment_items (
 item_id,module_id,source_id,source_document_id,source_url,page_number,source_page_sha256,
 question_fa,options_json,correct_option,explanation_fa,cognitive_level,difficulty_estimate,
 content_review_status,psychometric_status,pilot_status,metadata_json,created_at
)
SELECT 'NDS-Q035','NDS-M10',c.source_id,d.source_document_id,d.source_url,c.page_number,c.content_sha256,
 'طبق ساختار چک‌لیست NDS، پس از تعیین جهت روند در تایم‌فریم بالاتر، اقدام بعدی برای یافتن ورود چیست؟',
 '[{"option":"A","text":"ورود فوری در همان تایم‌فریم بالاتر بدون بررسی"},{"option":"B","text":"رفتن به تایم‌فریم ورود پایین‌تر و جست‌وجوی ستاپ 123Flag در جهت روند بالاتر"},{"option":"C","text":"نادیده گرفتن روند بالاتر و معامله خلاف جهت آن"},{"option":"D","text":"تعیین حجم معامله پیش از مشخص‌شدن ستاپ و حد ضرر"}]',
 'B',
 'صفحات 92 و 101-103 منبع، تشخیص روند بالاتر و سپس جست‌وجوی ستاپ ورود در تایم‌فریم پایین‌تر را شرح می‌دهند. مثال تایم‌فریم‌ها در منبع متغیر است و نباید به اعداد ثابت تعمیم داده شود.',
 'apply','medium','draft_content_review','not_piloted','not_piloted',
 '{"source_exact_page_hash":true,"psychometric_validity":false,"review_note":"Tests order of checklist stages; timeframe examples are not fixed universal parameters."}',
 '2026-11-10T00:00:00Z'
FROM gs_source_chunks c JOIN gs_source_documents d ON d.source_id=c.source_id
WHERE c.source_id='academia-nds-farsi' AND c.page_number=103
 AND c.content_sha256='c3c53e1ac81d15e9002f94f53a102ab311c5751fda0c02016ee5d992bcbca859';
