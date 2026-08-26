const fs = require('fs')
const path = require('path')
const https = require('https')

const API_BASE = 'https://aistudio.baidu.com/llm/lmapp/ernie-image/search'
const OUTPUT_PATH = path.join(__dirname, '../resources/inspirations.json')

async function fetchPage(page, pageSize = 20) {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}?page=${page}&pageSize=${pageSize}`
    https.get(url, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.errorCode === 0) {
            resolve(json.result)
          } else {
            reject(new Error(json.errorMsg))
          }
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

function mapToInspiration(item) {
  const tags = Array.isArray(item.tag) ? item.tag : []
  
  // Map tags to categories
  let category = '创意'
  if (tags.some(t => t.includes('人物') || t.includes('角色'))) category = '人物'
  else if (tags.some(t => t.includes('风景') || t.includes('建筑'))) category = '风景'
  else if (tags.some(t => t.includes('动漫') || t.includes('卡通'))) category = '动漫'
  else if (tags.some(t => t.includes('设计') || t.includes('创意'))) category = '设计'
  
  return {
    id: `ernie-${item.conversationId}`,
    title: tags[0] || 'AI 创作',
    prompt_cn: item.prompt, // Keep original English prompt
    prompt_en: item.prompt,
    category,
    tags: tags.slice(0, 5), // Limit to 5 tags
    ref_image: item.images?.[0]?.url,
    cover_image: item.images?.[0]?.url
  }
}

async function fetchAllInspirations(maxPages = 5) {
  console.log('Fetching inspirations from ERNIE Image API...')
  
  const allInspirations = []
  
  for (let page = 1; page <= maxPages; page++) {
    try {
      console.log(`Fetching page ${page}/${maxPages}...`)
      const result = await fetchPage(page, 20)
      
      const inspirations = result.data.map(mapToInspiration)
      allInspirations.push(...inspirations)
      
      console.log(`✓ Got ${inspirations.length} items from page ${page}`)
      
      // Stop if we've reached the end
      if (result.data.length < 20) {
        console.log('Reached end of results')
        break
      }
    } catch (e) {
      console.error(`Failed to fetch page ${page}:`, e.message)
      break
    }
  }
  
  console.log(`\nTotal inspirations fetched: ${allInspirations.length}`)
  
  // Save to file
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allInspirations, null, 2), 'utf-8')
  console.log(`Saved to: ${OUTPUT_PATH}`)
  
  return allInspirations
}

// Run if called directly
if (require.main === module) {
  const maxPages = parseInt(process.argv[2]) || 5
  fetchAllInspirations(maxPages).catch(console.error)
}

module.exports = { fetchAllInspirations, fetchPage, mapToInspiration }
