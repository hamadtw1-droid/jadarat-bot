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

// السماح للمواقع الخارحية
app.use(cors());
app.use(express.static(publicDir));

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
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-blink-features=AutomationControlled',
                '--window-size=1920,1080'
            ]
        }); 
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'ar-SA,ar;q=0.9,en;q=0.8'
        });
        
        const targetLinks = [
            { url: 'https://jadarat.sa/ExploreJobs?JobTab=1', category: 'القطاع الخاص' },
            { url: 'https://jadarat.sa/ExploreJobs?JobTab=4', category: 'التعاقد الحكومي' }
        ];

        let allJobData = [];

        for (const target of targetLinks) {
            console.log(`\n🌐 جاري مسح قطاع: ${target.category} ...`);
            await page.goto(target.url, { waitUntil: 'networkidle2', timeout: 60000 });
            
            // فرض لغة عربية
            await page.evaluate(() => {
                localStorage.setItem('lang', 'ar');
                localStorage.setItem('language', 'ar');
                document.cookie = "lang=ar; path=/";
                
                const elements = Array.from(document.querySelectorAll('a, button, span'));
                const arabBtn = elements.find(el => el.innerText.trim() === 'عربي' || el.innerText.trim() === 'العربية' || el.innerText.trim() === 'AR');
                if (arabBtn) arabBtn.click();
            });

            await new Promise(r => setTimeout(r, 8000)); // انتظار التحميل
            
            const scrapedData = await page.evaluate((categoryName) => {
                const data = [];
                const cards = Array.from(document.querySelectorAll('.list-item, div[id*="-l2-"]'));
                
                if (cards.length > 0) {
                    cards.forEach((card, index) => {
                        const rawText = card.innerText.split('\n').map(t => t.trim()).filter(t => t.length > 2);
                        if (rawText.length >= 3) {
                            const linkEl = card.querySelector('a[href*="JobDetails"]');
                            const title = linkEl ? linkEl.innerText.trim() : rawText[0];
                            const url = linkEl ? linkEl.href : '';
                            
                            let company = "جهة غير محددة";
                            let location = "غير محدد";

                            for (let i = 0; i < rawText.length; i++) {
                                if (rawText[i].includes('الشركة') || rawText[i].includes('المنشأة') || rawText[i].includes('Employer')) {
                                    const cleaned = rawText[i].replace('الشركة', '').replace('المنشأة', '').replace('Employer', '').replace(':', '').trim();
                                    if (cleaned.length > 2) company = cleaned;
                                    else if (rawText[i+1]) company = rawText[i+1];
                                }
                                if (rawText[i].includes('المنطقة') || rawText[i].includes('المدينة') || rawText[i].includes('المدن') || rawText[i].includes('Region')) {
                                    const cleaned = rawText[i].replace('المنطقة', '').replace('المدينة', '').replace('المدن', '').replace('Region', '').replace(':', '').trim();
                                    if (cleaned.length > 2) location = cleaned;
                                    else if (rawText[i+1]) location = rawText[i+1];
                                }
                            }

                            if (location === "غير محدد") {
                                const knownCities = ["الرياض", "جدة", "مكة", "الدمام", "الخبر", "تبوك", "أبها", "المدينة", "بريدة", "حائل", "نجران", "جازان", "عرعر", "سكاكا", "طريف", "الجبيل", "ينبع", "شرورة", "القصيم"];
                                const foundCity = rawText.find(t => knownCities.some(c => t.includes(c)));
                                if (foundCity) location = foundCity;
                                else if (rawText.length > 3 && rawText[3].length < 20) location = rawText[3]; 
                            }

                            if (company === "جهة غير محددة") {
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
                                    url: url,
                                    category: categoryName,
                                    date: new Date().toLocaleDateString('ar-SA'),
                                    source: 'جدارات'
                                });
                            }
                        }
                    });
                }
                return data;
            }, target.category);
            
            // أخذ أفضل 25 وظيفة من كل قطاع لضمان التوازن
            const uniqueSectorJobs = scrapedData.filter((v, i, a) => a.findIndex(v2 => (v2.title === v.title && v2.company === v.company)) === i).slice(0, 25);
            allJobData = allJobData.concat(uniqueSectorJobs);
        }

        // دمج ومزج الوظائف التعاقدية مع الخاصة لكي تظهر للمستخدم
        const jobData = allJobData; // العدد النهائي سيكون 50 (25 خاص + 25 حكومي)

        if(jobData.length > 0) {
            let oldJobs = [];
            if (fs.existsSync(jobsFile)) {
                oldJobs = JSON.parse(fs.readFileSync(jobsFile));
            }

            const newJobs = jobData.filter(newJob => {
                return !oldJobs.some(oldJob => oldJob.title === newJob.title && oldJob.company === newJob.company);
            });

            fs.writeFileSync(jobsFile, JSON.stringify(jobData, null, 2));
            console.log(`✅ تم السحب بنجاح! إجمالي: ${jobData.length} وظيفة (منها ${newJobs.length} وظائف جديدة).`);

            const tPart1 = "8628316864";
            const tPart2 = "AAGIns2VGw7pIgUDHC9DAvIAn7McxQOFebk";
            const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || `${tPart1}:${tPart2}`;
            const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "1411425836";
            
            if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID && newJobs.length > 0 && oldJobs.length > 0) {
                console.log(`🚀 جاري إرسال إشعارات التليغرام...`);
                for (const [i, job] of newJobs.entries()) {
                    setTimeout(async () => {
                        const message = `🚨 طرح وظيفي جديد (${job.category})\n▪️ المسمى: ${job.title}\n▪️ القطاع: ${job.company}\n📍 المدينة: ${job.location}\n\n🔗 للتقديم السريع:\n${job.url || 'https://jadarat.sa/'}`;
                        
                        try {
                            const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, disable_web_page_preview: true })
                            });
                            if(response.ok) console.log(`📨 نجح إرسال: ${job.title}`);
                        } catch(e) {
                            console.error('❌ فشل الإرسال');
                        }
                    }, i * 3000);
                }
            }
        } else {
            console.log(`⚠️ لم يتمكن المحرك من العثور على وظائف.`);
        }
        
        await browser.close();
        console.log("-----------------------------------------");
    } catch (error) {
        console.error("❌ حدث خطأ:", error);
    }
}

cron.schedule('0 */6 * * *', () => { runScraper(); });
runScraper();

app.listen(PORT, () => {
    console.log(`🚀 الرادار يعمل 24/7. الاستماع على ${PORT}`);
});
