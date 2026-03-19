document.addEventListener('DOMContentLoaded', () => {
    const jobsContainer = document.getElementById('jobsContainer');
    const resultsCount = document.getElementById('resultsCount');
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const cityFilter = document.getElementById('cityFilter');

    let allJobs = [];

    // جلب البيانات بمسار نسبي ليعمل على أي استضافة (cPanel/UltaHost)
    fetch('./jobs.json')
        .then(response => {
            if(!response.ok) throw new Error('الشبكة غير متصلة');
            return response.json();
        })
        .then(jobs => {
            allJobs = jobs;
            populateCities(allJobs);
            renderJobs(allJobs);
        })
        .catch(error => {
            console.error('Error fetching jobs:', error);
            jobsContainer.innerHTML = `
                <div style="text-align:center; padding: 2rem; color: #ef4444; grid-column: 1 / -1; width: 100%;">
                    <i class="fa-solid fa-circle-exclamation fa-2x"></i>
                    <p style="margin-top: 1rem; font-weight: 700;">حدث خطأ أثناء تحميل الوظائف. الرجاء التأكد من تشغيل السيرفر لتحديث البيانات بشكل آلي.</p>
                </div>
            `;
            resultsCount.textContent = 'حدث خطأ';
        });

    function populateCities(jobs) {
        const uniqueCities = [...new Set(jobs.map(job => job.location))];
        uniqueCities.forEach(city => {
            const option = document.createElement('option');
            option.value = city;
            option.textContent = `📍 ${city}`;
            cityFilter.appendChild(option);
        });
    }

    // دالة عامة لنسخ نص التليغرام من المربع عند الضغط على الزر
    window.copyTelegramText = function(btnElement) {
        const textArea = btnElement.previousElementSibling;
        textArea.select();
        textArea.setSelectionRange(0, 99999); // للهواتف الذكية

        navigator.clipboard.writeText(textArea.value).then(() => {
            const originalText = btnElement.innerHTML;
            btnElement.innerHTML = `تم النسخ بنجاح ✅`;
            btnElement.style.backgroundColor = '#0d8364';
            btnElement.style.color = 'white';
            
            setTimeout(() => {
                btnElement.innerHTML = originalText;
                btnElement.style.backgroundColor = 'transparent';
                btnElement.style.color = '#0d8364';
            }, 2000);
        });
    };

    function renderJobs(jobsToRender) {
        jobsContainer.innerHTML = ''; 

        if (jobsToRender.length === 0) {
            resultsCount.textContent = 'لم يتم العثور على وظائف مطابقة للبحث.';
            return;
        }

        resultsCount.textContent = `تم العثور على ${jobsToRender.length} وظيفة`;

        jobsToRender.forEach((job, index) => {
            const jobCard = document.createElement('div');
            jobCard.className = 'job-card animated-card';
            jobCard.style.animationDelay = `${index * 0.1}s`;

            // تجهيز صيغة الإعلان الخاصة بالتليغرام
            const telegramText = `🚨 إعلان وظيفي جديد
▪️ المسمى: ${job.title}
▪️ جهة العمل: ${job.company}
📍 المدينة: ${job.location}

🔗 للتقديم عبر المنصة الوطنية (جدارات):
${job.url || 'https://jadarat.sa/'}
`;

            jobCard.innerHTML = `
                <div class="job-card-header">
                    <div class="job-info">
                        <h3>${job.title}</h3>
                        <p class="company"><i class="fa-solid fa-building"></i> ${job.company}</p>
                    </div>
                    ${job.source ? `<span class="source-badge">${job.source}</span>` : ''}
                </div>
                
                <div class="job-meta">
                    <div class="meta-item">
                        <i class="fa-solid fa-location-dot"></i>
                        <span>${job.location}</span>
                    </div>
                </div>

                <div class="job-actions">
                    <button class="btn btn-primary" onclick="window.open('${job.url || 'https://jadarat.sa/'}', '_blank')">التقديم الآن <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.8rem; margin-right: 0.3rem;"></i></button>
                    <button class="btn-icon" title="حفظ الوظيفة للمفضلة"><i class="fa-regular fa-heart"></i></button>
                </div>

                <!-- مساحة مخصصة لمدير الموقع (للنشر في تليغرام) -->
                <div class="telegram-box" style="margin-top: 1.5rem; border-top: 1px dashed #cbd5e1; padding-top: 1rem;">
                    <p style="font-size: 0.85rem; color: #334155; margin-bottom: 0.5rem; font-weight: 700;">
                        <i class="fa-brands fa-telegram" style="color: #0088cc;"></i> صيغة النشر للتليغرام:
                    </p>
                    <textarea readonly style="width: 100%; height: 125px; padding: 0.8rem; border: 1px solid #e2e8f0; border-radius: 8px; font-family: 'Tajawal', inherit; font-size: 0.85rem; resize: none; background: #f8fafc; color: #475569; outline: none;" onclick="this.select()">${telegramText}</textarea>
                    <button class="btn btn-outline" style="width: 100%; margin-top: 0.5rem; font-size: 0.85rem; padding: 0.6rem; display: flex; justify-content: center; align-items: center; gap: 0.5rem;" onclick="copyTelegramText(this)">
                        نسخ للنشر في القناة <i class="fa-regular fa-copy"></i>
                    </button>
                </div>
            `;
            jobsContainer.appendChild(jobCard);
        });
    }

    function performSearch() {
        const query = searchInput.value.toLowerCase().trim();
        const selectedCity = cityFilter.value;

        const filteredJobs = allJobs.filter(job => {
            const matchesQuery = job.title.toLowerCase().includes(query) ||
                                 job.company.toLowerCase().includes(query) ||
                                 job.location.toLowerCase().includes(query);
            
            const matchesCity = selectedCity === 'all' || job.location === selectedCity;

            return matchesQuery && matchesCity;
        });

        renderJobs(filteredJobs);
    }

    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('input', performSearch);
    cityFilter.addEventListener('change', performSearch);
});
