// imageUtils.js
import axios from 'axios'; 

export async function getRandomImage(query, sfw = true) {
  const endpoint = 'https://customsearch.googleapis.com/customsearch/v1';

  const params = {
    key: process.env.GOOGLE_API_KEY,
    cx: process.env.GOOGLE_CX,
    q: query,
    searchType: 'image',
    start: 1,
    safe: sfw ? 'active' : 'off',
  };
  
  try {
    const response = await axios.get(endpoint, { params });
    
    if (response.data.items && response.data.items.length > 0) {
      const imageLinks = response.data.items.map(item => item.link);
      const filteredImageLinks = imageLinks.filter(link => 
        !link.startsWith('https://lookaside') &&
        link.includes('.com') &&
        !link.includes('/wp_content/')
      );

      if (filteredImageLinks.length > 0) {
        const randomIndex = Math.floor(Math.random() * filteredImageLinks.length);
        return filteredImageLinks[randomIndex];
      } 
      else 
      {
        return "I can't show that!";
      }
    } else {
      return "I can't show that!";
    }


  } catch (error) {
    return "I can't show that!";
  }
}
