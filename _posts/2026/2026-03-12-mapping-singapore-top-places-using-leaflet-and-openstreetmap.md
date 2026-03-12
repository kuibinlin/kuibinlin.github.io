---
layout: post
title: Mapping Singapore’s Top Places Using Leaflet and OpenStreetMap
date: 2026-03-12 15:00:00 +0800
published: true
categories: website
media_subpath: /assets/media/2026/mapping-singapore-with-leaflet-openstreetmap/
image: singapore.png
tags: [map, leaflet, openstreet, singapore]
map:
  center: [1.3521, 103.8198] # required — [latitude, longitude]
  zoom: 11 # optional — 1 (world) to 18 (street), default: 13
  height: 500px # optional — any CSS value (px, vh, em), default: 450px
  width: 100% # optional — any CSS value (px, %, vw), default: 100%
  style: light # optional — default | dark | light | satellite, default: default
  markers: # optional — array of map markers
    - coords: [1.3502, 103.9940] # required — [latitude, longitude]
      popup: "Changi Airport" # optional — text shown when marker is clicked
      open: true # optional — popup opens on load, default: false
    - coords: [1.30441, 103.773]
      popup: "NUS Utown"
    - coords: [1.2838, 103.8591]
      popup: "Marina Bay Sands"
    - coords: [1.4043, 103.7930]
      popup: "Singapore Zoo"
    - coords: [1.2816, 103.8636]
      popup: "Garden by the Bay"
    - coords: [1.2815, 103.8448]
      popup: "Chinatown"
    - coords: [1.3066, 103.8518]
      popup: "Little India"
    - coords: [1.3169, 103.8973]
      popup: "Geylang Serai"
    - coords: [1.3138, 103.8159]
      popup: "Singapore Botanic Gardens"
    - coords: [1.2816, 103.8238]
      popup: "Universal Studios Singapore"
    - coords: [1.28147, 103.84433]
      popup: "Buddha Tooth Relic Temple"
    - coords: [1.4608, 103.8110]
      popup: "Sembawang God of Wealth Temple "
    - coords: [1.3027, 103.8587]
      popup: "Kampong Glam"
    - coords: [1.2815, 103.8448]
      popup: "Kampong Glam"
    - coords: [1.2806, 103.8503]
      popup: "Lau Pa Sat"
    - coords: [1.3016, 103.8585]
      popup: "Haji Lane"
    - coords: [1.3109, 103.7952]
      popup: "Holland Village"
    - coords: [1.3483, 103.6831]
      popup: "Nanyang Technological University"
---

> Why This Post Exists? This morning — 12 March 2026 — my friend **[Haoming Koo](https://haomingkoo.com)** showed me how he'd integrated an interactive map into his [blog post](https://kooexperience.com/travel/posts/italy.html). I thought it was a genuinely elegant touch — the kind of thing that makes a post feel alive rather than flat.
> By the afternoon I'd used Claude to build a Leaflet map plugin and wire it into this Jekyll static site. Haoming did the inspiring; I did the copy-cat-with-AI-assistance. If you're curious about his work, his personal site is [haomingkoo.com](https://haomingkoo.com) and his GitHub is [@haomingkoo](https://github.com/haomingkoo). Go give him a follow — he's the reason this post exists.
> This post is partly a test of that integration, and partly an excuse to write something useful: a proper introduction to Singapore for anyone visiting for the first time. If you're interested in adding interactive maps to your own Jekyll site, I've written a separate post walking through the full setup — [read it here](https://linsnotes.com/posts/how-to-add-interactive-maps-to-jekyll-using-leaflet-and-openstreetmap/).
{: .prompt-info }
---

Welcome to Singapore — a city-state that manages to feel simultaneously futuristic and deeply rooted in tradition. Whether you've just landed at Changi or are planning your first visit, this guide covers the places worth knowing about.
 
## Map
 
{% map %}
 
---
 
## Changi Airport
 
![Changi Airport](changi-airport.jpg)
 
Your Singapore experience likely begins at **Changi Airport** — and that's already part of the adventure. Consistently ranked the world's best airport, Changi houses indoor waterfalls, a rooftop pool, butterfly gardens, and a 10-storey slide across its terminals. The Jewel Changi complex, a glass-and-steel dome connecting three terminals, contains the world's tallest indoor waterfall. Don't rush through it. The airport is a genuine attraction in its own right, and a quiet signal that Singapore takes everything — even arrivals — seriously.
 
---
 
## Marina Bay Sands
 
![Marina Bay Sands](marina-bay-sands.jpg)
 
Few skylines anywhere rival what awaits you at **Marina Bay Sands**. The three-tower hotel crowned by a 340-metre sky-park is Singapore's most recognisable silhouette. Head to the observation deck at sunset and the whole city spreads out below — the bay, the financial district, Sentosa in the distance. The integrated resort also houses the ArtScience Museum, a casino, and a waterfront mall that has become a destination in its own right. The light-and-water show at the bay (Spectra) runs nightly and is free to watch from the promenade.
 
---
 
## Gardens by the Bay
 
![Gardens by the Bay](gardens-by-the-bay.jpg)
 
Just a short walk from Marina Bay Sands, **Gardens by the Bay** is a horticultural marvel built on reclaimed land. Eighteen towering Supertrees — some reaching 16 storeys — are draped in living plants and erupt in light and music each evening during the Garden Rhapsody show. The two climate-controlled conservatories, the Flower Dome and the Cloud Forest, transport you from Mediterranean landscapes to a tropical mountain cloudforest within a few hundred metres. One of the most ambitious public gardens built anywhere in the 21st century.
 
---
 
## Chinatown & Buddha Tooth Relic Temple
 
![Chinatown Singapore](chinatown.jpg)
![Chinatown Singapore](budda-tooth-relic-temple.jpg)
**Chinatown** is one of Singapore's oldest and most characterful quarters — a grid of shophouses selling dried seafood, heritage crafts, and herbal medicine, with some of the island's best hawker food tucked in between. At its heart stands the **Buddha Tooth Relic Temple**, a striking Tang Dynasty-style structure on South Bridge Road. The four-storey temple museum offers a thoughtful introduction to the community that shaped much of modern Singapore, and the relic housed within — said to be a tooth of the historical Buddha — draws pilgrims year-round. During Chinese New Year, Chinatown transforms entirely: lanterns, lion dances, and street bazaars that run late into the night.
 
---
 
## Little India
 
![Little India Singapore](little-india.jpg)
 
**Little India** is the most sensory-rich neighbourhood in Singapore. The streets around Serangoon Road are alive with the fragrance of jasmine garlands, Tamil film music spilling from shopfronts, and stalls piled high with silk, spices, and gold jewellery. Sri Veeramakaliamman Temple, one of Singapore's oldest Hindu temples, anchors the neighbourhood spiritually. Come on a Sunday evening when the area fills with the week's last social energy and the pavements become an impromptu community gathering. For food, this is the place for South Indian banana-leaf meals, roti prata, and biryani.
 
---
 
## Kampong Glam & Haji Lane
 
![Kampong Glam](kampong-glam.jpg)
![Haji Lane](haji-lane.jpg)
 
**Kampong Glam** is Singapore's historic Malay-Arab quarter, centred on the golden-domed Sultan Mosque — the largest mosque in the country. The surrounding streets are lined with textile shops, oud perfumeries, and a growing collection of independent cafés and restaurants. Just one block away, **Haji Lane** is a narrow, brightly painted alley that has become one of Singapore's most distinctive streets: independent boutiques, vintage stores, and café-hopping culture packed into barely 200 metres. Wander here on a Friday evening when the neighbourhood is most alive.
 
---
 
## Geylang Serai
 
![Geylang Serai](geylang-serai.jpg)
 
**Geylang Serai** is the cultural heartland of Singapore's Malay community and one of the most authentic neighbourhoods on the island. The Geylang Serai Market (Pasar Geylang Serai) is a bustling wet market and food centre offering Malay and Indonesian dishes that are harder to find elsewhere in Singapore. During Ramadan, the area hosts one of the island's most atmospheric night bazaars — a long stretch of food stalls, batik, and traditional crafts under festoon lights. It's the kind of neighbourhood that rewards walking slowly.
 
---
 
## Lau Pa Sat
 
![Lau Pa Sat](lau-pa-sat.jpg)
 
**Lau Pa Sat** is Singapore's most storied hawker destination — a Victorian cast-iron market hall built in 1894, sitting improbably in the middle of the gleaming CBD. By night, the adjacent Boon Tat Street closes to traffic and becomes Singapore's most famous satay row, charcoal smoke rising between glass towers. It has fed everyone from construction workers to heads of state. Anthony Bourdain featured it on *No Reservations*; Gordon Ramsay has pointed to Singapore's hawker culture — with Lau Pa Sat as its emblem — as among the most impressive food destinations in Asia. Delegations attending the historic 2018 Trump–Kim Summit were brought to experience hawker culture here. Come hungry, order the satay, and stay for a cold Tiger Beer.
 
---
 
## Singapore Botanic Gardens
 
![Singapore Botanic Gardens](botanic-garden.jpg)
 
The **Singapore Botanic Gardens** has been a public green space since 1859, making it one of the oldest in Asia — and in 2015 it became Singapore's first UNESCO World Heritage Site. The National Orchid Garden within holds over 1,000 species and 2,000 hybrids, including the Vanda Miss Joaquim, Singapore's national flower. Come on a weekday morning before the heat peaks, when the gardens are quiet and the light is extraordinary. Entrance to the main gardens is free.
 
---
 
## Universal Studios Singapore
 
![Universal Studios Singapore](universal-studios.jpg)
 
Located on Sentosa Island, **Universal Studios Singapore** is Southeast Asia's first Universal theme park. Across seven themed zones — Hollywood, New York, Sci-Fi City, Ancient Egypt, The Lost World, Far Far Away, and Madagascar — the park packs rides, shows, and live entertainment into a compact and well-run space. It draws families, couples, and solo visitors equally. Buy tickets in advance, arrive at opening time, and head to the most popular rides first to avoid the queues that build by mid-morning.
 
---
 
## Singapore Zoo
 
![Singapore Zoo](singapore-zoo.jpg)
 
The **Singapore Zoo** is consistently rated one of the world's best. Rather than traditional enclosures, most animals live in naturalistic habitats separated from visitors by concealed moats — the result feels more like walking through forest than visiting a conventional zoo. The adjacent Night Safari, the world's first nocturnal wildlife park, is a separate experience entirely: a tram ride through tropical forest after dark, with free-roaming animals visible in simulated moonlight. If you can only choose one, the Night Safari is the more unforgettable.
 
---
 
## Sembawang God of Wealth Temple
 
Tucked in the quiet northern reaches of Singapore, this **God of Wealth Temple** is one of the island's most spiritually potent Taoist shrines. According to my friend Haoming — who knows the temple well — prayers here are remarkably efficacious: people come with sincere intentions and leave feeling heard. The deity enshrined is Caishen, the God of Wealth, and devotees travel from across Singapore and the wider region to seek blessings for business ventures, prosperity, and good fortune.
 
The best times to visit are during **Chinese New Year**, when the temple is alive with incense, offerings, and worshippers, and especially on the **5th day of the first lunar month** — the birthday of the God of Wealth. On that day, crowds arrive from midnight onwards to be among the first to offer incense when the new day begins. The atmosphere is electric, the devotion is genuine, and the experience is unlike anything you'll find in the tourist districts downtown. If you're in Singapore around Chinese New Year, make the trip north.
 
---
 
## Holland Village
 
**Holland Village** occupies a comfortable middle ground between expat enclave and neighbourhood local. For decades it has been home to long-term foreign residents, NUS academics, and Singaporeans who appreciate its relatively low-rise streetscape and unhurried pace. The main strip along Lorong Mambong is lined with restaurants spanning every cuisine, wine bars, independent shops, and a café culture more common in Melbourne than Southeast Asia. It's not a must-see destination so much as a pleasant half-day when you want to step off the tourist track and eat and drink well.
 
---
 
## National University of Singapore

 
**NUS UTown** (University Town) is the residential and social heart of the National University of Singapore — consistently one of Asia's top-ranked universities. The campus is a self-contained community of learning spaces, residences, sports facilities, and eateries spread across a well-landscaped precinct. The Stephen Riady Centre at its heart is open to the public and a pleasant place to work or have coffee. A good reminder that Singapore's long-term competitive advantage has always been built on its people.
 
---
 
## Nanyang Technological University (NTU)
 
 
**Nanyang Technological University** is one of the world's leading research universities and Singapore's most architecturally distinctive campus. The iconic Hive (Learning Hub), designed by Heatherwick Studio, looks unlike anything else on the island — a cluster of stacked pods in terracotta and concrete that manages to feel both alien and organic. The campus spreads across western Singapore near Jurong, with forested paths connecting faculties. Architecture enthusiasts and those interested in what a 21st-century university campus can look like should make the trip.
 
---
 
## Practical Notes for First-Timers
 
**Getting around:** The MRT (Mass Rapid Transit) is clean, cheap, punctual, and air-conditioned. Get a stored-value EZ-Link card at any station. Most places on this map are reachable by rail; NTU and Sembawang are most conveniently reached by bus or Grab.
 
**Weather:** Singapore sits 1° north of the equator. It is always warm (26–33°C), always humid, and liable to rain without warning. Carry a small folding umbrella and stay hydrated.
 
**Safety:** Singapore is exceptionally safe. Standard common sense is all you need.
 
**Language:** English is the working language — used for government, business, and signage — so you will have no trouble communicating anywhere on this map. But Singapore is officially quadrilingual: **Mandarin**, **Malay**, and **Tamil** are the other three official languages, each reflecting one of the island's major communities. Malay holds a special status as the national language and is used in the national anthem. Among the older Chinese community you'll also hear dialects — **Hokkien** and **Cantonese** most prominently — spoken at hawker centres, wet markets, and between neighbours. Listening to the city switch between languages mid-conversation is one of the small pleasures of being here.
 
---
 
Singapore rewards curiosity. Every neighbourhood has its own character, its own food, its own pace. The markers above are starting points. Give yourself time to get lost — this city has a way of surprising you long after you think you've understood it.