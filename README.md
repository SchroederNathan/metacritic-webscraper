# Metacritic Game Scraper

A simple TypeScript scraper that searches Metacritic for games by name and returns the best match with its metascore rating and available platforms.

## Installation

Install dependencies using Bun:

```bash
bun install
```

## Usage

Run the scraper with a game name:

```bash
bun metacritic-game-scraper.ts "Fortnite"
```

### Examples

```bash
# Search for Fortnite
bun metacritic-game-scraper.ts "Fortnite"

# Search for Grand Theft Auto V
bun metacritic-game-scraper.ts "Grand Theft Auto V"

# Search for ARC Raiders
bun metacritic-game-scraper.ts "Arc Raiders"
```

## Output Format

The scraper returns JSON with the following structure:

```json
[
  {
    "name": "Fortnite",
    "platforms": [
      "playstation-4",
      "pc",
      "xbox-one",
      "ios",
      "switch",
      "playstation-5",
      "xbox-series-x"
    ],
    "slug": "fortnite",
    "url": "https://www.metacritic.com/game/playstation-4/fortnite/",
    "metascore": 78
  }
]
```

### Fields

- **name**: The game's title
- **platforms**: Array of all platforms the game is available on (normalized platform names)
- **slug**: URL slug for the game
- **url**: Full Metacritic URL to the game page
- **metascore**: Metascore rating (0-100), if available

## How It Works

The scraper uses Metacritic's backend API endpoint to search for games, which provides:
- Fast, reliable results
- Direct access to metascore data
- Complete platform information
- No HTML parsing required

## Important Notes

**Educational Use Only**: This scraper is for educational purposes only. Metacritic's Terms of Service prohibit automated scraping.

**Server-Side Only**: Do not run this client-side. Metacritic uses bot protections and may block automated requests.

**Rate Limiting**: Be respectful with your usage. Don't make excessive requests that could impact Metacritic's servers.

## Requirements

- [Bun](https://bun.sh) runtime (v1.2.22 or later)
- TypeScript support

## Dependencies

- `undici` - HTTP client for API requests
- `cheerio` - HTML parsing (fallback only)
- `ms` - Time parsing utilities

## License

This project is for educational purposes only. Use responsibly and in accordance with Metacritic's Terms of Service.
