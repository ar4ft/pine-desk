export const examples=[{id:'ema-cross',name:'EMA crossover strategy',source:`//@version=6
strategy("EMA crossover", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=20, commission_type=strategy.commission.percent, commission_value=0.1, slippage=2)
fast = ta.ema(close, input.int(12, "Fast length"))
slow = ta.ema(close, input.int(26, "Slow length"))
plot(fast, "Fast EMA", color=color.aqua, linewidth=2)
plot(slow, "Slow EMA", color=color.orange, linewidth=2)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("Short", strategy.short)`},{id:'rsi',name:'RSI indicator',source:`//@version=6
indicator("Relative strength", overlay=false)
plot(ta.rsi(close, input.int(14, "Length")), "RSI", color=color.aqua)
hline(70, "Overbought")
hline(30, "Oversold")`},{id:'bands',name:'Bollinger bands',source:`//@version=6
indicator("Bollinger bands", overlay=true)
length = input.int(20, "Length")
basis = ta.sma(close, length)
dev = 2.0 * ta.stdev(close, length)
plot(basis, "Basis", color=color.aqua)
plot(basis + dev, "Upper", color=color.orange)
plot(basis - dev, "Lower", color=color.orange)`}];
