from manim import *

class NewtonThirdLaw(Scene):
    def construct(self):
        # Create objects
        object1 = Circle(color=BLUE).shift(LEFT * 3)
        object2 = Circle(color=RED).shift(RIGHT * 3)
        arrow1 = Arrow(object1.get_center(), object2.get_center(), color=GREEN)
        arrow2 = Arrow(object2.get_center(), object1.get_center(), color=GREEN)
        
        # Show initial state
        self.play(Create(object1), Create(object2))
        self.wait(1)
        
        # Show first caption
        caption1 = Text("क्रिया र प्रतिक्रिया", font_size=28).to_edge(DOWN)
        self.play(Write(caption1), run_time=2)
        self.wait(1)
        
        # Move object1 towards object2
        self.play(object1.animate.shift(RIGHT * 2))
        self.wait(1)
        
        # Show second caption
        self.play(FadeOut(caption1))
        caption2 = Text("न्यूटनको तेस्रो नियम", font_size=28).to_edge(DOWN)
        self.play(Write(caption2), run_time=3)
        self.wait(1)
        
        # Show force exerted by object2 on object1
        self.play(Create(arrow1))
        self.wait(1)
        
        # Show force exerted by object1 on object2
        self.play(Create(arrow2))
        self.wait(1)
        
        # Show third caption
        self.play(FadeOut(caption2))
        caption3 = Text("दुई वस्तु बीचको अन्तरक्रिया", font_size=28).to_edge(DOWN)
        self.play(Write(caption3), run_time=4)
        self.wait(10)