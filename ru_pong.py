import turtle
import winsound

wn = turtle.Screen()
wn.title("Pong Game")
wn.bgcolor("black")
wn.setup(width=800, height=600)
wn.tracer(0)

score_a = 0
score_b = 0
game_started = False

#A
paddle_a = turtle.Turtle()
paddle_a.speed(0)
paddle_a.shape("square")
paddle_a.color("white")
paddle_a.shapesize(stretch_wid=5, stretch_len=1)
paddle_a.penup()
paddle_a.goto(-350, 0)

#B
paddle_b = turtle.Turtle()
paddle_b.speed(0)
paddle_b.shape("square")
paddle_b.color("white")
paddle_b.shapesize(stretch_wid=5, stretch_len=1)
paddle_b.penup()
paddle_b.goto(350, 0)

# Ball
ball = turtle.Turtle()
ball.speed(0)
ball.shape("square")
ball.color("white")
ball.penup()
ball.goto(0, 0)
ball.dx = 0.27
ball.dy = -0.27

# Pen
pen = turtle.Turtle()
pen.speed(0)
pen.color("white")
pen.penup()
pen.hideturtle()
pen.goto(0, 260)
pen.write("Player A: 0  Player B: 0", align="center", font=("Courier", 24, "normal"))

def start_game():
    global game_started
    game_started = True

def paddle_a_up():
    start_game()
    y = paddle_a.ycor()
    paddle_a.sety(y + 35)

def paddle_a_down():
    start_game()
    y = paddle_a.ycor()
    paddle_a.sety(y - 35)

def paddle_b_up():
    start_game()
    y = paddle_b.ycor()
    paddle_b.sety(y + 35)

def paddle_b_down():
    start_game()
    y = paddle_b.ycor()
    paddle_b.sety(y - 35)

wn.listen()
wn.onkeypress(paddle_a_up, "w")
wn.onkeypress(paddle_a_down, "s")
wn.onkeypress(paddle_b_up, "Up")
wn.onkeypress(paddle_b_down, "Down")

while True:
    wn.update()

    if game_started:
        ball.setx(ball.xcor() + ball.dx)
        ball.sety(ball.ycor() + ball.dy)

    if ball.ycor() > 290:
        ball.sety(290)
        ball.dy *= -1

    if ball.ycor() < -290:
        ball.sety(-290)
        ball.dy *= -1

    #Player A scores)
    if ball.xcor() > 390:
        winsound.PlaySound("super-mario-death-sound-sound-effect.wav", winsound.SND_ASYNC)
        ball.goto(0, 0)
        ball.dx *= -1
        score_a += 1
        pen.clear()
        pen.write(f"Player A: {score_a}  Player B: {score_b}",
                  align="center", font=("Courier", 24, "normal"))

    #Player B scores)
    if ball.xcor() < -390:
        winsound.PlaySound("super-mario-death-sound-sound-effect.wav", winsound.SND_ASYNC)
        ball.goto(0, 0)
        ball.dx *= -1
        score_b += 1
        pen.clear()
        pen.write(f"Player A: {score_a}  Player B: {score_b}",
                  align="center", font=("Courier", 24, "normal"))

    #
    if (340 < ball.xcor() < 350) and (paddle_b.ycor() - 40 < ball.ycor() < paddle_b.ycor() + 40):
        ball.setx(340)
        ball.dx *= -1
        winsound.PlaySound("love-bounce.wav", winsound.SND_ASYNC)

    #
    if (-350 < ball.xcor() < -340) and (paddle_a.ycor() - 40 < ball.ycor() < paddle_a.ycor() + 40):
        ball.setx(-340)
        ball.dx *= -1
        winsound.PlaySound("love-bounce.wav", winsound.SND_ASYNC)
