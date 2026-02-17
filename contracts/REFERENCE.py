"""
DegenPizza v4 – Simplified Zero-Sum Coordination Game Simulator
===============================================================

Core formula:
    score_i = uniqueness_i^α × (β + contribution_i)
    payout_i = (score_i / Σ scores) × pot

Everyone antes equally. Pot always fully distributed. Zero-sum trivially.

The game tension:
- Uniqueness is a GATE: if you play the same as everyone else, you score zero.
- Contribution is a MULTIPLIER: helping the recipe amplifies your score.
- The β floor gives a small reward for being unique even when unhelpful.
- Optimal play = find a DIFFERENT way to help the recipe than everyone else.

Usage:
    python3 degenpizza_v4_sim.py [num_players] [alpha] [beta]
    python3 degenpizza_v4_sim.py 20          # 20 players, default α=1.0 β=0.3
    python3 degenpizza_v4_sim.py 10 1.5 0.1  # 10 players, α=1.5, β=0.1
"""

import math
import random
import sys
from dataclasses import dataclass, field

# ── Game Constants ─────────────────────────────────────────────────

INGREDIENTS = ["dough", "sauce", "cheese", "mushroom", "pepperoni", "anchovy"]
NUM_INGREDIENTS = 6       # Always 6 fixed ingredients
UNITS_PER_PLAYER = 5      # Each player distributes exactly 5 integer units
NUM_ROUNDS = 10            # 10 rounds per game
STARTING_SCORE = 100.0     # Everyone starts with 100 tokens
ANTE = 10.0                # Fixed cost per round (10% of starting balance)

# ── Tunable Parameters ─────────────────────────────────────────────

ALPHA = 1.0   # Uniqueness exponent — higher = harsher herding punishment
              #   1.0 = linear (default), 2.0 = quadratic (near-average → worthless)

BETA = 0.3    # Contribution floor — minimum payoff multiplier for being unique
              #   Score = uniq^α × (β + contribution)
              #   At β=0.3: unique+unhelpful gets 0.3, unique+helpful gets up to 1.3
              #   So being helpful gives ~4.3x more than pure chaos
              #   Lower β → more reward for helping recipe, less for pure chaos


# ── Recipe Generation ──────────────────────────────────────────────

def generate_recipe() -> list[float]:
    """
    Generate a random recipe (target proportions for 6 ingredients).
    
    Constraints ensure interesting gameplay:
    - All 6 ingredients present (min 5% each)
    - Sorted descending (dough always highest, anchovy always lowest)
    - Top 3 ingredients >= 40% combined
    - No proportion evenly divisible by 20% — this ensures that with only
      5 integer units, players CANNOT perfectly match the recipe. Forces
      strategic tradeoffs in allocation.
    - Stored as basis points (hundredths of %) for on-chain precision
    """
    while True:
        # Generate 6 random values and normalize to proportions
        raw = sorted([random.random() for _ in range(NUM_INGREDIENTS)], reverse=True)
        total = sum(raw)
        props = [r / total for r in raw]

        # Reject if any ingredient < 5%
        if any(p < 0.05 for p in props):
            continue

        # Reject if top 3 don't dominate enough (< 40%)
        if sum(props[:3]) < 0.40:
            continue

        # Reject if any proportion is too close to a clean 20% multiple
        # (would make the recipe trivially solvable with 5 units)
        bad = False
        for p in props:
            for mult in [0.20, 0.40, 0.60, 0.80, 1.00]:
                if abs(p - mult) < 0.005:
                    bad = True
                    break
            if bad:
                break
        if bad:
            continue

        # Convert to basis points for integer precision (like on-chain storage)
        bps = [round(p * 10000) for p in props]
        diff = 10000 - sum(bps)       # Fix rounding error
        bps[0] += diff                 # Adjust largest ingredient

        # Verify constraints still hold after rounding
        if bps != sorted(bps, reverse=True):
            continue
        if any(b < 500 for b in bps):  # 500 bps = 5%
            continue

        return [b / 10000.0 for b in bps]


# ── Scoring Functions ──────────────────────────────────────────────

def compute_quality(pool, recipe):
    """
    Measure how close the group's combined pizza is to the ideal recipe.
    
    quality = exp(-5.0 × euclidean_distance(pool_proportions, recipe))
    
    Range: [0, 1] where 1 = perfect match, 0 = terrible match.
    The -5.0 multiplier makes quality decay quickly — small deviations
    from the recipe cause significant quality drops.
    
    NOTE: Quality is informational only. It does NOT directly affect
    individual scores or payouts. It's computed for display and to
    calculate each player's contribution (see compute_contribution).
    
    Args:
        pool: list[float] — total units per ingredient across all players
        recipe: list[float] — target proportions (sum to 1.0)
    """
    pool_total = sum(pool)
    if pool_total == 0:
        return 0.0

    # Convert raw unit counts to proportions for comparison with recipe
    proportions = [p / pool_total for p in pool]

    # Euclidean distance between actual proportions and target recipe
    distance = math.sqrt(sum((proportions[j] - recipe[j]) ** 2 for j in range(NUM_INGREDIENTS)))

    # Exponential decay: small distances → high quality, large → near zero
    return math.exp(-5.0 * distance)


def compute_uniqueness(contributions):
    """
    Measure how different each player's allocation is from the group average.
    
    For each player:
        raw_i = euclidean_distance(player_i_allocation, group_average)
        uniqueness_i = raw_i / max(all_raw)
    
    Range: [0, 1] per player.
    - 1.0 = most different player from the average
    - 0.0 = identical to the average (or everyone played the same thing)
    
    Key property: uniqueness is RELATIVE. What counts as "unique" changes
    every round based on what everyone else plays. There's no absolute
    unique strategy — only relative positioning.
    
    If all players submit identical allocations → all uniqueness = 0.0,
    which triggers the flat-split failsafe (everyone gets ante back).
    
    Args:
        contributions: list[list[int]] — each player's ingredient allocation
    """
    n = len(contributions)
    if n <= 1:
        return [0.5] * n  # Solo player gets neutral uniqueness

    # Compute the group average allocation per ingredient
    avg = [sum(contributions[i][j] for i in range(n)) / n for j in range(NUM_INGREDIENTS)]

    # Euclidean distance of each player from the average
    raw = []
    for i in range(n):
        d = math.sqrt(sum((contributions[i][j] - avg[j]) ** 2 for j in range(NUM_INGREDIENTS)))
        raw.append(d)

    # Normalize: most unique player = 1.0, identical to average = 0.0
    max_raw = max(raw) if raw else 1.0
    if max_raw == 0:
        return [0.0] * n  # Everyone identical → zero uniqueness for all

    return [r / max_raw for r in raw]


def compute_contribution(contributions, recipe):
    """
    Measure how much each player helped (or hurt) the pizza quality.
    
    Uses a "leave-one-out" approach:
        contribution_raw_i = quality_with_everyone - quality_without_player_i
    
    Positive = removing you makes the pizza worse = you HELPED
    Negative = removing you makes the pizza better = you HURT
    
    Raw values are min-max normalized to [0, 1]:
        1.0 = most helpful player
        0.0 = most harmful player
        0.5 = everyone contributed equally
    
    This is the most gas-expensive part for Solidity — requires N+1
    calls to compute_quality (1 with everyone + N leave-one-out).
    
    Args:
        contributions: list[list[int]] — each player's ingredient allocation
        recipe: list[float] — target proportions
    """
    n = len(contributions)

    # Total pool: sum of all players' contributions per ingredient
    pool = [sum(contributions[i][j] for i in range(n)) for j in range(NUM_INGREDIENTS)]

    # Quality with everyone included
    q_all = compute_quality(pool, recipe)

    # Leave-one-out: how does quality change without each player?
    raw = []
    for i in range(n):
        pool_without = [pool[j] - contributions[i][j] for j in range(NUM_INGREDIENTS)]
        q_without = compute_quality(pool_without, recipe)
        # Positive = you helped (quality drops without you)
        # Negative = you hurt (quality improves without you)
        raw.append(q_all - q_without)

    # Min-max normalize to [0, 1]
    mn, mx = min(raw), max(raw)
    if mx == mn:
        return [0.5] * n  # Everyone contributed equally

    return [(r - mn) / (mx - mn) for r in raw]


def compute_scores(contributions, recipe):
    """
    Compute all scoring components for a round.
    
    The core formula:
        score_i = uniqueness_i^α × (β + contribution_i)
    
    This creates the key game dynamics:
    - uniqueness^α is a GATE: zero uniqueness = zero score, period
    - (β + contribution) is a MULTIPLIER: ranges from β (unhelpful) to β+1 (max helpful)
    - α controls how harshly near-average play is punished
    - β controls the floor for unique-but-unhelpful play
    
    Returns: (quality, uniqueness_list, contribution_list, score_list)
    """
    pool = [sum(contributions[i][j] for i in range(len(contributions))) for j in range(NUM_INGREDIENTS)]
    quality = compute_quality(pool, recipe)          # Informational only
    uniqueness = compute_uniqueness(contributions)    # Gate: [0, 1]
    contribution = compute_contribution(contributions, recipe)  # Multiplier: [0, 1]

    # Apply the scoring formula
    scores = []
    for i in range(len(contributions)):
        u = uniqueness[i]
        c = contribution[i]
        # The magic formula: uniqueness gates, contribution amplifies
        s = (u ** ALPHA) * (BETA + c)
        scores.append(s)

    return quality, uniqueness, contribution, scores


# ── Data Structures ────────────────────────────────────────────────

@dataclass
class PlayerRound:
    """One player's results for a single round."""
    ingredients: list[int]       # Their allocation (6 ints summing to 5)
    uniqueness: float = 0.0      # How different from the group [0, 1]
    contribution: float = 0.0    # How much they helped the recipe [0, 1]
    score: float = 0.0           # uniqueness^α × (β + contribution)
    payout: float = 0.0          # Their share of the pot
    net: float = 0.0             # payout - ante (profit/loss this round)


@dataclass
class RoundResult:
    """Results for an entire round."""
    round_num: int
    recipe: list[float]          # The target recipe this round
    quality: float               # How good the group pizza was [0, 1]
    pot: float                   # Total tokens in the pot
    players: dict[str, PlayerRound] = field(default_factory=dict)


@dataclass
class Game:
    """
    Full game state manager.
    
    Handles: player balances, round progression, recipe management,
    scoring, payouts, and elimination.
    """
    player_names: list[str]
    player_scores: dict[str, float] = field(default_factory=dict)
    current_round: int = 0
    recipe_main: list[float] = field(default_factory=list)    # Used rounds 1-9
    recipe_final: list[float] = field(default_factory=list)   # Used round 10 only
    history: list[RoundResult] = field(default_factory=list)
    eliminated: set[str] = field(default_factory=set)

    def __post_init__(self):
        if not self.player_scores:
            for name in self.player_names:
                self.player_scores[name] = STARTING_SCORE
        if not self.recipe_main:
            self.recipe_main = generate_recipe()
        if not self.recipe_final:
            self.recipe_final = generate_recipe()

    @property
    def active_players(self):
        """Players who haven't been eliminated (balance >= ante)."""
        return [p for p in self.player_names if p not in self.eliminated]

    def current_recipe(self):
        """Round 10 uses a fresh recipe to disrupt established patterns."""
        return self.recipe_final if self.current_round == NUM_ROUNDS else self.recipe_main

    def play_round(self, contributions):
        """
        Execute one round of the game.
        
        Flow:
        1. Deduct ante from all participating players
        2. Compute scoring (uniqueness, contribution, scores)
        3. Distribute pot proportional to scores
        4. Eliminate any player who can't afford next round's ante
        
        If all scores = 0 (everyone played identically): flat split,
        everyone gets their ante back. This is the Nash equilibrium
        of identical play — stable but boring.
        """
        self.current_round += 1
        recipe = self.current_recipe()
        active = self.active_players
        players_in = [p for p in active if p in contributions]

        # Validate: exactly 5 non-negative units across 6 ingredients
        for p in players_in:
            assert sum(contributions[p]) == UNITS_PER_PLAYER
            assert all(u >= 0 for u in contributions[p])
            assert len(contributions[p]) == NUM_INGREDIENTS

        # Step 1: Everyone antes — fixed cost, no wagering
        for p in players_in:
            self.player_scores[p] -= ANTE

        # Pot = total antes. Always fully distributed. Zero-sum guaranteed.
        pot = ANTE * len(players_in)
        contribs_list = [contributions[p] for p in players_in]

        # Step 2: Score everyone
        quality, uniqueness, contribution, scores = compute_scores(contribs_list, recipe)
        total_score = sum(scores)

        result = RoundResult(
            round_num=self.current_round, recipe=recipe, quality=quality, pot=pot,
        )

        # Step 3: Distribute pot
        for idx, p in enumerate(players_in):
            if total_score == 0:
                # Flat split failsafe: everyone played identically
                # Nobody gains, nobody loses. Stable but unstable — any
                # single deviant would capture outsized returns.
                payout = pot / len(players_in)
            else:
                # Pro-rata by score: higher score = bigger slice
                payout = (scores[idx] / total_score) * pot

            pr = PlayerRound(
                ingredients=contributions[p],
                uniqueness=uniqueness[idx],
                contribution=contribution[idx],
                score=scores[idx],
                payout=payout,
                net=payout - ANTE,
            )
            result.players[p] = pr
            self.player_scores[p] += payout

            # Step 4: Eliminate if can't afford next ante
            if self.player_scores[p] < ANTE:
                self.eliminated.add(p)

        self.history.append(result)
        return result

    def is_over(self):
        """Game ends after 10 rounds or when <=1 player remains."""
        return self.current_round >= NUM_ROUNDS or len(self.active_players) <= 1

    def final_standings(self):
        """Return players sorted by final balance (descending)."""
        return sorted(self.player_scores.items(), key=lambda x: x[1], reverse=True)


# ── AI Player ──────────────────────────────────────────────────────

def optimal_allocation(recipe):
    """
    Greedy recipe-matching: allocate 5 units to best approximate the recipe.
    
    This is the "naive" strategy — try to match the recipe proportions
    as closely as possible. It's helpful for quality but terrible for
    uniqueness when everyone does it (the herding trap).
    """
    alloc = [0] * NUM_INGREDIENTS
    for _ in range(UNITS_PER_PLAYER):
        # Place each unit where it reduces distance to recipe the most
        current_total = sum(alloc) + 1
        best_j = max(range(NUM_INGREDIENTS),
                     key=lambda j: recipe[j] - alloc[j] / current_total)
        alloc[best_j] += 1
    return alloc


# Pre-compute ALL possible 5-unit allocations across 6 ingredients.
# This is C(10,5) = 252 combinations (stars and bars).
# Used by AI to brute-force search the best allocation against predictions.
ALL_ALLOCS = []
def _gen(remaining, idx, current):
    """Recursively generate all ways to distribute `remaining` units across ingredients."""
    if idx == NUM_INGREDIENTS - 1:
        ALL_ALLOCS.append(current + [remaining])
        return
    for u in range(remaining + 1):
        _gen(remaining - u, idx + 1, current + [u])
_gen(UNITS_PER_PLAYER, 0, [])


def ai_strategy(name, rnd, game, prng):
    """
    AI decision-making: choose the best allocation for this round.
    
    Strategy:
    1. Predict what other players will do (based on their last round
       or assuming they'll play recipe-optimal)
    2. Brute-force search all 252 possible allocations
    3. For each, estimate uniqueness and contribution against predictions
    4. Pick the allocation that maximizes expected score
    5. Add small random noise to break ties and add variety
    
    This is a simplified opponent model — real players would have more
    sophisticated prediction. The 50/50 mix of "replay last round" vs
    "assume recipe-optimal" creates reasonable diversity.
    """
    recipe = game.current_recipe()
    n_active = len(game.active_players)

    # ── Step 1: Predict what others will play ──────────────────────
    estimated_others = []
    if game.history:
        last = game.history[-1]
        for p, pr in last.players.items():
            if p != name and p not in game.eliminated:
                # 50% chance: assume they repeat last round's play
                # 50% chance: assume they play recipe-optimal
                if prng.random() < 0.5:
                    estimated_others.append(list(pr.ingredients))
                else:
                    estimated_others.append(optimal_allocation(recipe))

    # Fill remaining slots with recipe-optimal assumption (round 1 or new players)
    while len(estimated_others) < n_active - 1:
        estimated_others.append(optimal_allocation(recipe))
    estimated_others = estimated_others[:n_active - 1]

    # ── Step 2: Search all 252 allocations for best expected score ──
    best_alloc = optimal_allocation(recipe)  # Fallback
    best_expected = -999

    for alloc in ALL_ALLOCS:
        all_contribs = [alloc] + estimated_others

        # Quick uniqueness estimate (same math as compute_uniqueness)
        n = len(all_contribs)
        avg = [sum(all_contribs[i][j] for i in range(n)) / n for j in range(NUM_INGREDIENTS)]
        my_dist = math.sqrt(sum((alloc[j] - avg[j]) ** 2 for j in range(NUM_INGREDIENTS)))
        all_dists = [math.sqrt(sum((all_contribs[i][j] - avg[j]) ** 2 for j in range(NUM_INGREDIENTS))) for i in range(n)]
        max_d = max(all_dists) if all_dists else 1.0
        my_uniq = my_dist / max_d if max_d > 0 else 0.0

        # Quick contribution estimate (simplified — not full leave-one-out normalization)
        pool = [sum(all_contribs[i][j] for i in range(n)) for j in range(NUM_INGREDIENTS)]
        q_all = compute_quality(pool, recipe)
        pool_without = [pool[j] - alloc[j] for j in range(NUM_INGREDIENTS)]
        q_without = compute_quality(pool_without, recipe)
        my_contrib_raw = q_all - q_without
        # Rough normalization: clamp to [0, 1] with 0.5 center
        my_contrib = max(0.0, min(1.0, 0.5 + my_contrib_raw * 5.0))

        # Expected score using the same formula as the actual scoring
        expected = (my_uniq ** ALPHA) * (BETA + my_contrib)
        # Small random noise to break ties and prevent deterministic herding
        expected += prng.gauss(0, 0.01)

        if expected > best_expected:
            best_expected = expected
            best_alloc = alloc

    return best_alloc


# ── Display Functions ──────────────────────────────────────────────

def print_round(result, game):
    """Print detailed results for a single round."""
    is_final = result.round_num == NUM_ROUNDS
    n = len(result.players)
    print(f"\n{'='*95}")
    label = f"  ROUND {result.round_num}" + (" — FINAL (new recipe)" if is_final else "")
    print(label)
    print(f"{'='*95}")
    print(f"  Quality: {result.quality:.3f} | Pot: {result.pot:.0f} ({n} × {ANTE:.0f}) | α={ALPHA} β={BETA}")

    # Sort by net profit (winners first)
    sorted_players = sorted(result.players.items(), key=lambda x: x[1].net, reverse=True)

    print(f"\n  {'Player':<8} {'Alloc':<30} {'Uniq':>5} {'Contr':>5} {'Score':>6} {'Pay':>6} {'Net':>7} {'Bal':>7}")
    print(f"  {'─'*82}")

    winners = 0
    for name, pr in sorted_players:
        bal = game.player_scores[name]
        elim = " ☠" if name in game.eliminated else ""
        # Only show ingredients with non-zero allocation
        alloc = " ".join(f"{INGREDIENTS[i][:3]}:{pr.ingredients[i]}" for i in range(NUM_INGREDIENTS) if pr.ingredients[i] > 0)
        if pr.net > 0:
            winners += 1
        print(f"  {name:<8} {alloc:<30} {pr.uniqueness:>5.2f} {pr.contribution:>5.2f} {pr.score:>6.3f} {pr.payout:>6.1f} {pr.net:>+7.1f} {bal:>7.1f}{elim}")

    print(f"\n  Winners: {winners}/{n} | Biggest gain: {max(pr.net for pr in result.players.values()):+.1f} | Biggest loss: {min(pr.net for pr in result.players.values()):+.1f}")


def print_standings(game):
    """Print final game standings with visual bars and stats."""
    print(f"\n{'='*95}")
    print(f"  FINAL STANDINGS — α={ALPHA} β={BETA} ante={ANTE}")
    print(f"{'='*95}")
    total_start = len(game.player_names) * STARTING_SCORE
    standings = game.final_standings()

    for rank, (name, score) in enumerate(standings, 1):
        net = score - STARTING_SCORE
        pct = net / STARTING_SCORE * 100
        marker = "☠" if name in game.eliminated else ("▲" if net > 0 else "▼" if net < 0 else "—")
        bar_char = "█" if net > 0 else "░"
        bar = bar_char * min(int(abs(net) / 2), 35)
        print(f"  {rank:>2}. {name:<8} {score:>8.2f}  ({net:>+8.2f} | {pct:>+6.1f}%)  {marker} {bar}")

    # Summary statistics
    nets = [s - STARTING_SCORE for _, s in standings]
    winners = sum(1 for n in nets if n > 0)
    losers = sum(1 for n in nets if n < 0)

    # Gini coefficient: measures wealth inequality (0 = equal, 1 = one person has everything)
    gini_num = sum(abs(nets[i] - nets[j]) for i in range(len(nets)) for j in range(len(nets)))
    gini_den = 2 * len(nets) * sum(s for _, s in standings)
    gini = gini_num / gini_den if gini_den > 0 else 0

    # Verify zero-sum: total tokens should equal starting total
    total = sum(game.player_scores.values())
    print(f"\n  Winners: {winners} | Losers: {losers} | Eliminated: {len(game.eliminated)}")
    print(f"  Max gain: {max(nets):+.2f} | Max loss: {min(nets):+.2f}")
    print(f"  Gini: {gini:.3f}")
    print(f"  Tokens: {total:.2f} / {total_start:.2f} (diff: {total_start - total:.4f})")


# ── Main ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    random.seed(42)
    NUM_PLAYERS = int(sys.argv[1]) if len(sys.argv) > 1 else 20

    # Parse optional alpha/beta from command line
    if len(sys.argv) > 2:
        ALPHA = float(sys.argv[2])
    if len(sys.argv) > 3:
        BETA = float(sys.argv[3])

    names = [f"P{i+1:02d}" for i in range(NUM_PLAYERS)]
    game = Game(player_names=names)
    # Each AI player gets its own deterministic RNG for reproducibility
    player_rngs = {n: random.Random(hash(n) + 42) for n in names}

    # ── Header ─────────────────────────────────────────────────────
    print("=" * 95)
    print("  DEGENPIZZA v4 — Simplified: No Wagers, No Carry")
    print(f"  score = uniq^{ALPHA} × ({BETA} + contribution) | ante={ANTE} | pot always fully distributed")
    print("=" * 95)

    print(f"\n  Players: {NUM_PLAYERS} | Starting: {STARTING_SCORE} | Ante: {ANTE}/round")
    print(f"  α={ALPHA} (uniqueness power) | β={BETA} (floor without contribution)")

    # Display both recipes
    print(f"\n  Main recipe (R1-9):")
    for i in range(NUM_INGREDIENTS):
        bar = "█" * int(game.recipe_main[i] * 40)
        print(f"    {INGREDIENTS[i]:<12} {game.recipe_main[i]*100:>5.1f}%  {bar}")
    print(f"\n  Final recipe (R10):")
    for i in range(NUM_INGREDIENTS):
        bar = "█" * int(game.recipe_final[i] * 40)
        print(f"    {INGREDIENTS[i]:<12} {game.recipe_final[i]*100:>5.1f}%  {bar}")

    # ── Game Loop ──────────────────────────────────────────────────
    for rnd in range(1, NUM_ROUNDS + 1):
        active = game.active_players
        contributions = {}
        for p in active:
            contributions[p] = ai_strategy(p, rnd, game, player_rngs[p])
        if not contributions:
            break
        result = game.play_round(contributions)
        print_round(result, game)
        if game.is_over():
            break

    print_standings(game)

    # ── Post-Game Analysis ─────────────────────────────────────────
    print(f"\n{'='*95}")
    print(f"  ANALYSIS")
    print(f"{'='*95}")

    # Quality trend: shows how well the group cooperated each round
    print(f"\n  Quality per round:")
    for r in game.history:
        bar = "█" * int(r.quality * 40)
        print(f"    R{r.round_num:>2}: {r.quality:.3f}  {bar}")

    # Swing: gap between biggest winner and biggest loser each round
    # High swing = one player dominated, low swing = even distribution
    print(f"\n  Swing per round (biggest winner - biggest loser):")
    for r in game.history:
        nets = [pr.net for pr in r.players.values()]
        swing = max(nets) - min(nets)
        bar = "█" * int(swing / 2)
        print(f"    R{r.round_num:>2}: {swing:>6.1f}  {bar}")

    # Allocation diversity: avg pairwise euclidean distance between players
    # Low diversity = herding, high diversity = everyone playing differently
    print(f"\n  Allocation diversity (avg pairwise distance):")
    for r in game.history:
        contribs = [pr.ingredients for pr in r.players.values()]
        n = len(contribs)
        td = sum(math.sqrt(sum((contribs[i][k]-contribs[j][k])**2 for k in range(NUM_INGREDIENTS)))
                 for i in range(n) for j in range(i+1,n))
        pairs = n*(n-1)/2
        avg_d = td/pairs if pairs > 0 else 0
        bar = "█" * int(avg_d * 8)
        print(f"    R{r.round_num:>2}: {avg_d:.3f}  {bar}")

    # Herding detection: most common allocations across all rounds
    print(f"\n  Most played allocations:")
    alloc_counts = {}
    for r in game.history:
        for pr in r.players.values():
            key = tuple(pr.ingredients)
            alloc_counts[key] = alloc_counts.get(key, 0) + 1
    for alloc, count in sorted(alloc_counts.items(), key=lambda x: -x[1])[:10]:
        desc = " ".join(f"{INGREDIENTS[i][:3]}:{alloc[i]}" for i in range(NUM_INGREDIENTS) if alloc[i] > 0)
        pct = count / (NUM_ROUNDS * NUM_PLAYERS) * 100
        print(f"    {count:>3}x ({pct:>4.1f}%)  {desc}")

    # Round-by-round winner tracking
    print(f"\n  Round winners (most profit per round):")
    win_counts = {}
    for r in game.history:
        best = max(r.players.items(), key=lambda x: x[1].net)
        win_counts[best[0]] = win_counts.get(best[0], 0) + 1
        print(f"    R{r.round_num:>2}: {best[0]} ({best[1].net:+.1f})")
    
    print(f"\n  Repeat winners:")
    for p, count in sorted(win_counts.items(), key=lambda x: -x[1]):
        if count > 1:
            print(f"    {p}: {count} round wins")

    # ── Chart (matplotlib) ─────────────────────────────────────────
    try:
        import matplotlib
        matplotlib.use('Agg')  # Non-interactive backend for headless servers
        import matplotlib.pyplot as plt
        import numpy as np

        # Build per-round balance trajectories for all players
        rounds_x = list(range(NUM_ROUNDS + 1))
        player_bals = {n: [STARTING_SCORE] for n in names}
        quality_vals = []
        swing_vals = []

        running = {n: STARTING_SCORE for n in names}
        for r in game.history:
            nets = []
            for name, pr in r.players.items():
                running[name] += pr.net
                nets.append(pr.net)
            for n in names:
                player_bals[n].append(running.get(n, player_bals[n][-1]))
            quality_vals.append(r.quality)
            swing_vals.append(max(nets) - min(nets))

        fig, axes = plt.subplots(2, 2, figsize=(16, 12))
        fig.suptitle(f'DEGENPIZZA v4 — No Wagers, No Carry (α={ALPHA}, β={BETA})', fontsize=16, fontweight='bold')

        cmap = plt.colormaps.get_cmap('tab20')
        colors = {n: cmap(i / len(names)) for i, n in enumerate(names)}

        # Top-left: Balance trajectories over time
        ax = axes[0][0]
        for n in names:
            style = '--' if n in game.eliminated else '-'
            ax.plot(rounds_x, player_bals[n], color=colors[n], linewidth=1.2, linestyle=style, alpha=0.7)
        ax.axhline(y=STARTING_SCORE, color='gray', linestyle='--', alpha=0.3)
        ax.set_ylabel('Balance')
        ax.set_title('Balance Trajectories')
        ax.set_xlabel('Round')

        # Top-right: Final ranking bar chart
        ax = axes[0][1]
        final_sorted = sorted([(n, game.player_scores[n]) for n in names], key=lambda x: -x[1])
        bar_colors = ['#2ecc71' if s > STARTING_SCORE else '#e74c3c' for _, s in final_sorted]
        ax.barh(range(len(final_sorted)), [s for _, s in final_sorted], color=bar_colors, alpha=0.8)
        ax.set_yticks(range(len(final_sorted)))
        ax.set_yticklabels([n for n, _ in final_sorted], fontsize=7)
        ax.axvline(x=STARTING_SCORE, color='gray', linestyle='--', alpha=0.5)
        ax.set_xlabel('Final Balance')
        ax.set_title('Final Rankings')
        ax.invert_yaxis()

        # Bottom-left: Quality per round (how well the group cooperated)
        ax = axes[1][0]
        rx = list(range(1, NUM_ROUNDS + 1))
        ax.bar(rx, quality_vals, color='#3498db', alpha=0.7, width=0.4, label='Quality')
        ax.set_ylabel('Quality')
        ax.set_title('Quality per Round')
        ax.set_xlabel('Round')
        ax.set_ylim(0, 1)
        ax.legend(fontsize=8)

        # Bottom-right: Volatility per round (gap between biggest winner and loser)
        ax = axes[1][1]
        ax.bar(rx, swing_vals, color='#e67e22', alpha=0.8, width=0.6)
        ax.set_ylabel('Swing (max gain - max loss)')
        ax.set_title('Round Volatility')
        ax.set_xlabel('Round')

        plt.tight_layout()
        chart_path = '/data/.openclaw/media/outbound/degenpizza_v4.png'
        plt.savefig(chart_path, dpi=150, bbox_inches='tight')
        plt.close()
        print(f"\n  Chart saved to {chart_path}")
    except Exception as e:
        print(f"\n  Chart error: {e}")
