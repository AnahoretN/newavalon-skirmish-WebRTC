/**
 * Script to update image URLs in contentDatabase.json
 * Maps old URLs to new optimized WebP versions
 */

const NEW_IMAGE_URLS: Record<string, string> = {
  // Fusion
  'Zealous Missionary': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365287/FUS_ZEALOUS_MISSIONARY_v7qjhw.webp',
  'Unwavering Integrator': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365287/FUS_UNWAVERING_INTEGRATOR_g1cbag.webp',
  'Signal Prophet': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365286/FUS_SIGNAL_PROPHET_rmk9me.webp',
  'Code Keeper': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365286/FUS_CODE_KEEPER_yhowqj.webp',
  'Devout Synthetic': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365286/FUS_DEVOUT_SYNTHETIC_nkr1tx.webp',

  // Hoods
  'Reckless Provocateur': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365268/HOO_RECKLESS_PROVOCATEUR_wvfdcr.webp',
  'Vigilant Spotter': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365268/HOO_VIGILANT_SPOTTER_xo8ig7.webp',
  'Inventive Maker': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365268/HOO_INVENTIVE_MAKER_sicb73.webp',
  'Data Liberator': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365268/HOO_DATA_LIBERATOR_qeru3j.webp',
  'Cautious Avenger': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365268/HOO_CAUTIOUS_AVENGER_xzk6pd.webp',

  // Optimates
  'Princeps': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365252/OPT_PRINCEPS_aaqakx.webp',
  'Immunis': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365252/OPT_IMMUNIS_hvlxhi.webp',
  'Centurion': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365251/OPT_CENTURION_grztbi.webp',
  'Censor': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365250/OPT_CENSOR_w4qijk.webp',
  'Faber': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365251/OPT_FABER_cr804w.webp',

  // SynchroTech
  'Tactical Agent': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365237/SYN_TACTICAL_AGENT_vquxfm.webp',
  'Threat Analyst': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365237/SYN_THREAT_ANALYST_uqxbsp.webp',
  'Patrol Agent': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365236/SYN_PATROL_AGENT_nlyneg.webp',
  'Riot Agent': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365236/SYN_RIOT_AGENT_i4lk5m.webp',
  'IP Dept Agent': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365235/SYN_IP_DEPT_AGENT_pbvh9e.webp',

  // Tokens
  'Recon Drone': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365220/TKN_RECON_DRONE_w3elir.webp',
  'Walking Turret': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365220/TKN_WALKING_TURRET_c0mttm.webp',

  // Command Cards
  'Inspiration': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365197/CMD_INSPIRATION_v0bi3l.webp',
  'Data Interception': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365197/CMD_DATA_INTERCEPTION_gen1qw.webp',
  'False Orders': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365197/CMD_FALSE_ORDERS_aatcmc.webp',
  'Repositioning': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365197/CMD_REPOSITIONING_uhwvrk.webp',
  'Mobilization': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365197/CMD_MOBILIZATION_afbovx.webp',
  'Overwatch': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365196/CMD_OVERWATCH_djwlqo.webp',

  // Status Icons / Counters
  'Stun': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365403/Stun_pbe7ex.webp',
  'Support': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365402/Support_hxzufw.webp',
  'Aim': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365400/Aim_qzeaqn.webp',
  'Exploit': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365398/Exploit_pf2zwf.webp',
  'medal': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365397/medal_tavarc.webp',
  'LastPlayed': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365397/LastPlayed_ge4gyh.webp',
  'Shield': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365393/Shield_yilhdt.webp',
  'Revealed': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365393/Revealed_lsan64.webp',
  'Resurrected': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365394/Resurrected_awaucv.webp',

  // UI Icons
  'winners cup': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365401/winners_cup_onnz9b.webp',
  'NA_icon': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365394/NA_icon_hicg8u.webp',
  'no target': 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365317/no_tarket_lndzoc.webp',
}

/**
 * Generate placeholder URL (blurry, low quality)
 */
export function getPlaceholderUrl(originalUrl: string): string {
  if (!originalUrl.includes('cloudinary.com/dxxh6meej')) {
    return originalUrl
  }

  // Insert q_10,e_blur:1000 before /vXXXXXX/
  return originalUrl.replace(
    /\/image\/upload\/(v\d+)\//,
    '/image/upload/q_10,e_blur:1000/$1/'
  )
}

/**
 * Generate optimized URL (best quality, auto format)
 */
export function getOptimizedUrl(originalUrl: string): string {
  if (!originalUrl.includes('cloudinary.com/dxxh6meej')) {
    return originalUrl
  }

  // Already optimized?
  if (originalUrl.includes('/q_auto') || originalUrl.includes('/f_auto')) {
    return originalUrl
  }

  // Insert q_auto,f_auto before /vXXXXXX/
  return originalUrl.replace(
    /\/image\/upload\/(v\d+)\//,
    '/image/upload/q_auto,f_auto/$1/'
  )
}

export { NEW_IMAGE_URLS }
