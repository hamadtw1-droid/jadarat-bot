const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3005;
const publicDir = path.join(__dirname, 'public');
const jobsFile = path.join(publicDir, 'jobs.json');

// السماح للمواقع الخارحية (مثل موقعك على UltaHost) بجلب البيانات بدون رسالة حظر (CORS Policy)
app.use(cors());
app.use(express.static(publicDir));

// مسار API مخصص لتغذية الواجهة
app.get('/api/jobs', (req, res) => {
    if (fs.existsSync(jobsFile)) {
        res.json(JSON.parse(fs.readFileSync(jobsFile)));
    } else {
        res.status(404).json({ error: "البيانات غير متوفرة بعد، جاري السحب..." });
    }
});

async function runScraper() {
    console.log("-----------------------------------------");
    console.log(`[${new Date().toLocaleString('ar-SA')}] 🔄 بدء عملية التحديث الآلي للوظائف...`);
    try {
        const browser = await puppeteer.launch({ 
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }); 
        const page = await browser.newPage();
        
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'ar-SA,ar;q=0.9,en;q=0.8'
        });
        
        console.log("🌐 الاتصال بمنصة جدارات (صفحة تصفح الوظائف)...");
        await page.goto('https://jadarat.sa/ExploreJobs?JobTab=1', { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log("محاولة إجبار الموقع على النسخة العربية...");
        // حيلة برمجية: نعدل التخزين المحلي للمتصفح لفرض لغة عربية ثم نضغط زر تغيير اللغة إن وُجد
        const isLangClicked = await page.evaluate(() => {
            localStorage.setItem('lang', 'ar');
            localStorage.setItem('language', 'ar');
            document.cookie = "lang=ar; path=/";
            
            // البحث عن زر تحويل اللغة للعربية واختياره
            const elements = Array.from(document.querySelectorAll('a, button, span'));
            const arabBtn = elements.find(el => el.innerText.trim() === 'عربي' || el.innerText.trim() === 'العربية' || el.innerText.trim() === 'AR');
            if (arabBtn) {
                arabBtn.click();
                return true;
            }
            return false;
        });

        if (isLangClicked) {
            console.log("تم النقر على زر اللغة العربية، ننتظر تحديث الصفحة...");
            await new Promise(r => setTimeout(r, 6000));
        } else {
            console.log("لم نجد زر اللغة أو تم الفرض محلياً، ننتظر تحميل البيانات...");
            await new Promise(r => setTimeout(r, 10000));
        }
        
        const jobData = await page.evaluate(() => {
            const data = [];
            // نبحث أولا عن هيكل بطاقات الأوت سيستم (OutSystems) المستخدم في جدارات
            const cards = Array.from(document.querySelectorAll('.list-item, div[id*="-l2-"]'));
            
            if (cards.length > 0) {
                cards.forEach((card, index) => {
                    const rawText = card.innerText.split('\n').map(t => t.trim()).filter(t => t.length > 2);
                    if (rawText.length >= 3) {
                        const linkEl = card.querySelector('a[href*="JobDetails"]');
                        const title = linkEl ? linkEl.innerText.trim() : rawText[0];
                        const url = linkEl ? linkEl.href : '';
                        
                        let company = "جهة قطاع خاص";
                        let location = "غير محدد";

                        for (let i = 0; i < rawText.length; i++) {
                            if (rawText[i].includes('الشركة') || rawText[i].includes('المنشأة') || rawText[i].includes('Employer')) {
                                const cleaned = rawText[i].replace('الشركة', '').replace('المنشأة', '').replace('Employer', '').replace(':', '').trim();
                                if (cleaned.length > 2) {
                                    company = cleaned;
                                } else if (rawText[i+1]) {
                                    company = rawText[i+1];
                                }
                            }
                            if (rawText[i].includes('المنطقة') || rawText[i].includes('المدينة') || rawText[i].includes('المدن') || rawText[i].includes('Region')) {
                                // إذا كانت تقرأ بهذا الشكل "المدن الرياض" أو "المدن: الرياض"
                                const cleaned = rawText[i].replace('المنطقة', '').replace('المدينة', '').replace('المدن', '').replace('Region', '').replace(':', '').trim();
                                if (cleaned.length > 2) {
                                    location = cleaned;
                                } else if (rawText[i+1]) {
                                    location = rawText[i+1];
                                }
                            }
                        }

                        // خطة قوية لجلب المدن إن لم تكتب بجانب كلمة (المنطقة / المدن) مطلقاً
                        if (location === "غير محدد") {
                            const knownCities = ["الرياض", "جدة", "مكة", "الدمام", "الخبر", "تبوك", "أبها", "المدينة", "بريدة", "حائل", "نجران", "جازان", "عرعر", "سكاكا", "طريف", "الجبيل", "ينبع", "شرورة", "القصيم"];
                            const foundCity = rawText.find(t => knownCities.some(c => t.includes(c)));
                            if (foundCity) location = foundCity;
                            else if (rawText.length > 3 && rawText[3].length < 20) location = rawText[3]; 
                        }

                        if (company === "جهة قطاع خاص") {
                            const companyLookup = rawText.find(t => t.includes('شركة') || t.includes('مؤسسة') || t.includes('مستشفى') || t.includes('جمعية'));
                            if (companyLookup) company = companyLookup;
                            else if (rawText.length > 2 && rawText[2] !== title && rawText[2].length < 50) company = rawText[2];
                        }

                        if (title && !title.toLowerCase().includes('employer') && !title.includes('شعار')) {
                            data.push({
                                id: index,
                                title: title,
                                company: company,
                                location: location,
                                url: url, // الرابط الأصلي
                                date: new Date().toLocaleDateString('ar-SA'),
                                source: 'جدارات'
                            });
                        }
                    }
                });
            }

            // خطة احتياطية في حال تغيرت كلاسات جدارات
            if (data.length === 0) {
                const jobLinks = Array.from(document.querySelectorAll('a')).filter(a => a.href && a.href.includes('JobDetails'));
                jobLinks.forEach((link, index) => {
                    let c = link;
                    // اصعد للشجرة حتى تكتمل بيانات البطاقة الوظيفية (على الأقل 4 أسطر نصية)
                    while (c && c.innerText.split('\n').filter(t => t.trim().length > 2).length < 4 && c.tagName !== 'BODY') {
                        c = c.parentElement;
                    }
                    if (c && c.tagName !== 'BODY') {
                        const rawText = c.innerText.split('\n').map(t => t.trim()).filter(t => t.length > 2);
                        const title = link.innerText.trim() || rawText[0];
                        const url = link.href;
                        
                        const knownCities = ["الرياض", "جدة", "مكة", "الدمام", "الخبر", "تبوك", "أبها", "المدينة", "بريدة", "حائل", "نجران", "جازان", "عرعر", "سكاكا", "طريف", "الجبيل", "ينبع", "شرورة", "القصيم"];
                        let location = rawText.find(t => knownCities.some(city => t.includes(city))) || "السعودية";
                        let company = rawText.find(t => t.includes('شركة') || t.includes('مؤسسة')) || rawText[1] || "جهة قطاع خاص";

                        if (title && !title.includes('شعار')) {
                            data.push({ id: index, title, company, location, url, date: new Date().toLocaleDateString('ar-SA'), source: 'جدارات' });
                        }
                    }
                });
            }

            const uniqueJobs = data.filter((v, i, a) => a.findIndex(v2 => (v2.title === v.title && v2.company === v.company)) === i);
            return uniqueJobs.slice(0, 25);
        });

        if(jobData.length > 0) {
            // أولاً: مقارنة الوظائف القديمة بالجديدة
            let oldJobs = [];
            if (fs.existsSync(jobsFile)) {
                oldJobs = JSON.parse(fs.readFileSync(jobsFile));
            }

            // استخراج "الوظائف الجديدة فقط" والتي لم تكن موجودة في الدفعة السابقة
            const newJobs = jobData.filter(newJob => {
                return !oldJobs.some(oldJob => oldJob.title === newJob.title && oldJob.company === newJob.company);
            });

            fs.writeFileSync(jobsFile, JSON.stringify(jobData, null, 2));
            console.log(`✅ تم تحديث الوظائف بنجاح! إجمالي: ${jobData.length} وظيفة (واكتشفنا ${newJobs.length} وظائف جديدة تماماً).`);

            // نظام إرسال الإشعارات لتليغرام
            const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8628316864:AAGIns2VGw7pIgUDHC9DAvIAn7McxQOFebk";
            const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "1411425836";
            
            if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID && newJobs.length > 0 && oldJobs.length > 0) {
                console.log(`🚀 جاري إرسال إشعارات التليغرام للوظائف الجديدة وعددهم (${newJobs.length})...`);
                
                // إرسالها بفاصل زمني لتجنب حظر رسائل تليغرام لكثرتها
                for (const [i, job] of newJobs.entries()) {
                    setTimeout(async () => {
                        const message = `🚨 وظيفة مطروحة للتو\n▪️ المسمى: ${job.title}\n▪️ القطاع: ${job.company}\n📍 المدينة: ${job.location}\n\n🔗 للتقديم السريع عبر جدارات:\n${job.url || 'https://jadarat.sa/'}`;
                        
                        try {
                            const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    chat_id: TELEGRAM_CHAT_ID,
                                    text: message,
                                    disable_web_page_preview: true
                                })
                            });
                            if(response.ok) console.log(`📨 تم إرسال إشعار لتليغرام بنجاح للوظيفة: ${job.title}`);
                        } catch(e) {
                            console.error('❌ فشل إرسال الإشعار', e);
                        }
                    }, i * 3000); // 3 ثواني تأخير بين كل رسالة
                }
            }
        } else {
            console.log(`⚠️ لم يتمكن المحرك من العثور على نصوص وظائف في هذه الجولة.`);
        }
        
        await browser.close();
        console.log("-----------------------------------------");
    } catch (error) {
        console.error("❌ حدث خطأ أثناء السحب الآلي:", error);
    }
}

cron.schedule('0 */6 * * *', () => {
    runScraper();
});

// Run once on startup
runScraper();

app.listen(PORT, () => {
    console.log(`🚀 النظام يعمل بنجاح! الموقع متاح الآن للزوار على الرابط: http://localhost:${PORT}`);
    console.log(`⏳ تم تفعيل "المحرك الآلي" لجلب الوظائف وسيعمل بالخلفية كل 6 ساعات.`);
});
